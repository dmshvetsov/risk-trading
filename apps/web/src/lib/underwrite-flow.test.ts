import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";

import {
  buildUnderwriteTransaction,
  executeUnderwrite,
  fetchAllCoins,
  pollUnderwriteReceipt,
  prepareUnderwrite,
  submitUnderwrite,
  totalCoinBalance,
  underwriteAvailability,
  validateSignedUnderwriteTransaction,
  normalizeTransactionBytes,
  type PreparedUnderwrite,
} from "./underwrite-flow";

const sellerKeypair = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7));
const seller = sellerKeypair.toSuiAddress();
const prepared: PreparedUnderwrite = {
  baseCoinType: "0x3::test_btc::TEST_BTC",
  buyerVaultId: `0x${"22".repeat(32)}`,
  feeRecipient: `0x${"33".repeat(32)}`,
  marketId: `0x${"44".repeat(32)}`,
  operationalFee: "25",
  packageId: `0x${"55".repeat(32)}`,
  quoteCoinType: "0x2::test_usdc::TEST_USDC",
  seriesId: `0x${"66".repeat(32)}`,
  signedOrderBytes: "AQID",
  status: "pending",
  target: `0x${"55".repeat(32)}::underwriting::underwrite_call`,
  underwriteId: "underwrite-1",
};

describe("underwrite flow", () => {
  it("loads every TEST_BTC coin page and totals its balance", async () => {
    const cursors: Array<string | null | undefined> = [];
    const client = {
      getCoins: async ({ cursor }: { cursor?: string | null }) => {
        cursors.push(cursor);
        return cursor
          ? { data: [{ balance: "300", coinObjectId: "0x3" }], hasNextPage: false, nextCursor: null }
          : { data: [{ balance: "100", coinObjectId: "0x1" }, { balance: "200", coinObjectId: "0x2" }], hasNextPage: true, nextCursor: "next" };
      },
    };

    const coins = await fetchAllCoins(client, seller, prepared.baseCoinType);

    assert.deepEqual(cursors, [undefined, "next"]);
    assert.equal(totalCoinBalance(coins), 600n);
  });

  it("disables earning when TEST_BTC is missing or insufficient", () => {
    assert.deepEqual(underwriteAvailability([], 5n), {
      enabled: false,
      label: "TEST_BTC NOT FOUND",
    });
    assert.deepEqual(
      underwriteAvailability([{ balance: "4", coinObjectId: "0x1" }], 5n),
      { enabled: false, label: "NOT ENOUGH TEST_BTC" },
    );
  });

  it("merges same-type coins, splits exact collateral, and calls underwrite_call", () => {
    const transaction = buildUnderwriteTransaction({
      coins: [
        { balance: "3000000", coinObjectId: `0x${"77".repeat(32)}` },
        { balance: "3000000", coinObjectId: `0x${"88".repeat(32)}` },
      ],
      collateralAmount: 5_000_000n,
      prepared,
      seller,
    });
    const commands = transaction.getData().commands;

    assert.equal(commands[0]?.$kind, "MergeCoins");
    assert.equal(commands[1]?.$kind, "SplitCoins");
    assert.equal(commands[2]?.$kind, "MoveCall");
    const moveCall = commands[2]?.MoveCall;
    assert.equal(moveCall?.function, "underwrite_call");
    assert.equal(moveCall?.module, "underwriting");
    assert.deepEqual(moveCall?.typeArguments, [prepared.quoteCoinType, prepared.baseCoinType]);
    assert.deepEqual(moveCall?.arguments.map((argument) => argument.$kind), [
      "Input", "Input", "Input", "NestedResult", "Input", "Input", "Input", "Input",
    ]);
    const inputs = transaction.getData().inputs;
    assert.equal(inputs[3]?.UnresolvedObject?.objectId, prepared.marketId);
    assert.equal(inputs[4]?.UnresolvedObject?.objectId, prepared.seriesId);
    assert.equal(inputs[5]?.UnresolvedObject?.objectId, prepared.buyerVaultId);
    assert.equal(inputs[2]?.Pure?.bytes, "QEtMAAAAAAA=");
    assert.equal(inputs[6]?.Pure?.bytes, "AwECAw==");
    assert.equal(inputs[7]?.Pure?.bytes, "GQAAAAAAAAA=");
    assert.equal(inputs[8]?.Pure?.bytes, "MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM=");
    assert.equal(inputs[9]?.Object?.SharedObject?.objectId.endsWith("06"), true);
  });

  it("sends prepare and submit payloads", async () => {
    const requests: Array<{ body: Record<string, unknown>; path: string }> = [];
    const request = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ body: JSON.parse(String(init?.body)), path: new URL(String(input)).pathname });
      return requests.length === 1
        ? Response.json(prepared, { status: 201 })
        : Response.json({ status: "queued", underwriteId: prepared.underwriteId }, { status: 202 });
    };
    const quote = { quote_id: "quote-1" };
    await prepareUnderwrite("https://rfq.test", seller, "5000000", quote, "quote-signature", request);
    await submitUnderwrite("https://rfq.test", prepared.underwriteId, "tx-bytes", "seller-signature", request);

    assert.deepEqual(requests, [
      { body: { contractsQtyDecimals: "5000000", quote, quoteSignature: "quote-signature", takerAddress: seller }, path: "/underwrites/prepare" },
      { body: { signatures: ["seller-signature"], transactionBytes: "tx-bytes" }, path: "/underwrites/underwrite-1/submit" },
    ]);
  });

  it("surfaces submit errors from the rfq server", async () => {
    await assert.rejects(
      submitUnderwrite(
        "https://rfq.test",
        prepared.underwriteId,
        "tx-bytes",
        "seller-signature",
        async () => Response.json(
          { error: "Invalid seller transaction signature" },
          { status: 400 },
        ),
      ),
      /Invalid seller transaction signature/,
    );
  });

  it("polls from pending to confirmed", async () => {
    let calls = 0;
    const receipt = await pollUnderwriteReceipt(
      "https://rfq.test",
      prepared.underwriteId,
      async () => Response.json({ status: ++calls === 1 ? "queued" : "confirmed", txDigest: calls === 2 ? "digest" : null }),
      async () => undefined,
    );

    assert.equal(calls, 2);
    assert.deepEqual(receipt, { status: "confirmed", txDigest: "digest" });
  });

  it("passes the complete PTB to the seller wallet and reports queued then confirmed", async () => {
    const statuses: string[] = [];
    let signedTransactionTarget = "";
    let receiptCalls = 0;
    const signed = await createSignedTransaction(sellerKeypair);
    const request = async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/prepare")) return Response.json(prepared, { status: 201 });
      if (path.endsWith("/submit")) {
        return Response.json({ status: "queued", underwriteId: prepared.underwriteId }, { status: 202 });
      }
      receiptCalls += 1;
      return Response.json({
        status: receiptCalls === 1 ? "queued" : "confirmed",
        txDigest: receiptCalls === 2 ? "digest" : null,
      });
    };

    await executeUnderwrite({
      coins: [{ balance: "5000000", coinObjectId: `0x${"77".repeat(32)}` }],
      contractsQtyDecimals: "5000000",
      onStatus: (status) => statuses.push(status),
      quote: { quote_id: "quote-1" },
      quoteSignature: "quote-signature",
      request,
      rfqApiUrl: "https://rfq.test",
      seller,
      signTransaction: async (transaction) => {
        const moveCall = transaction.getData().commands[1]?.MoveCall;
        signedTransactionTarget = `${moveCall?.package}::${moveCall?.module}::${moveCall?.function}`;
        return signed;
      },
      wait: async () => undefined,
    });

    assert.equal(signedTransactionTarget, prepared.target);
    assert.deepEqual(statuses, ["queued", "confirmed"]);
  });

  it("verifies the signed transaction bytes before submit", async () => {
    const signed = await createSignedTransaction(sellerKeypair);
    await validateSignedUnderwriteTransaction(signed.bytes, signed.signature, seller);
  });

  it("normalizes hex and base64url wallet transaction bytes", async () => {
    const signed = await createSignedTransaction(sellerKeypair);
    const raw = toBase64Bytes(signed.bytes);
    const hex = `0x${Array.from(raw, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const base64url = signed.bytes.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

    assert.equal(normalizeTransactionBytes(hex), signed.bytes);
    assert.equal(normalizeTransactionBytes(base64url), signed.bytes);
  });
});

async function createSignedTransaction(keypair: Ed25519Keypair) {
  const transaction = new Transaction();
  transaction.setSender(keypair.toSuiAddress());
  transaction.setGasPrice(1);
  transaction.setGasBudget(1_000_000);
  transaction.setGasPayment([{
    digest: "11111111111111111111111111111111",
    objectId: `0x${"99".repeat(32)}`,
    version: "1",
  }]);
  const bytes = await transaction.build();
  const signed = await keypair.signTransaction(bytes);
  return { bytes: toBase64(bytes), signature: signed.signature };
}

function toBase64Bytes(value: string) {
  return Uint8Array.from(Buffer.from(value, "base64"));
}
