import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { describe, it } from "vitest";

import {
  processUnderwriteSubmission,
  submitUnderwrite,
  underwriteReceipt,
} from "./underwrite-submission";
import type { D1Database, UnderwriteRow } from "./typedefs";

const seller = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(4));

describe("underwrite submission lifecycle", () => {
  it("verifies the seller, consumes capacity, and queues once", async () => {
    const fixture = await createFixture();
    const response = await submitUnderwrite(
      signedRequest(fixture.transactionBytes, fixture.signature),
      fixture.env,
      fixture.quoteStore,
      "underwrite-1",
    );

    assert.equal(response.status, 202, await response.clone().text());
    assert.equal(fixture.row.status, "queued");
    assert.equal(fixture.consumed, 1);
    assert.equal(fixture.queued.length, 1);
    assert.equal((fixture.queued[0] as { kind: string }).kind, "underwrite");
    assert.equal((await submitUnderwrite(
      signedRequest(fixture.transactionBytes, fixture.signature),
      fixture.env,
      fixture.quoteStore,
      "underwrite-1",
    )).status, 409);
  });

  it("rejects a transaction not signed by the prepared seller", async () => {
    const fixture = await createFixture();
    const attacker = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(5));
    const signature = (await attacker.signTransaction(fromBase64(fixture.transactionBytes))).signature;

    assert.equal((await submitUnderwrite(
      signedRequest(fixture.transactionBytes, signature),
      fixture.env,
      fixture.quoteStore,
      "underwrite-1",
    )).status, 400);
    assert.equal(fixture.row.status, "failed");
    assert.equal(
      fixture.row.failure_internal_code,
      "invalid_seller_transaction_signature",
    );
    assert.equal(fixture.queued.length, 0);
  });

  it("stores submitted and confirmed with the digest before ack", async () => {
    const fixture = await createFixture();
    const steps: string[] = [];
    await processUnderwriteSubmission({
      ack: () => steps.push("ack"),
      body: {
        kind: "underwrite",
        signatures: [fixture.signature],
        transactionBytes: fixture.transactionBytes,
        underwriteId: "underwrite-1",
      },
    }, fixture.env, async () => Response.json({ result: {
      digest: "digest-1",
      effects: { status: { status: "success" } },
    }}), (status) => steps.push(status));

    assert.deepEqual(steps, ["submitted", "confirmed", "ack"]);
    assert.equal(fixture.row.tx_digest, "digest-1");
    assert.equal(fixture.row.status, "confirmed");
  });

  it("stores fullnode error details when execution request is rejected", async () => {
    const fixture = await createFixture();

    await processUnderwriteSubmission({
      ack() {},
      body: {
        kind: "underwrite",
        signatures: [fixture.signature],
        transactionBytes: fixture.transactionBytes,
        underwriteId: "underwrite-1",
      },
    }, fixture.env, async () => Response.json({
      error: {
        data: "Invalid value was given to the function",
        message: "Invalid params",
      },
    }));

    assert.equal(fixture.row.status, "failed");
    assert.equal(
      fixture.row.failure_msg,
      "Invalid params: Invalid value was given to the function",
    );
  });

  it("returns safe failure details", async () => {
    const fixture = await createFixture();
    fixture.row.status = "failed";
    fixture.row.failure_internal_code = "rpc_failed";
    fixture.row.failure_msg = "secret upstream details";

    const response = await underwriteReceipt(fixture.env, "underwrite-1");
    assert.deepEqual(await response.json(), {
      failure: { code: "execution_failed", message: "Transaction failed" },
      status: "failed",
      txDigest: null,
      underwriteId: "underwrite-1",
    });
  });

  it("exposes every public receipt state", async () => {
    const fixture = await createFixture();
    for (const status of ["pending", "queued", "submitted", "confirmed"] as const) {
      fixture.row.status = status;
      fixture.row.tx_digest = status === "submitted" || status === "confirmed" ? "digest-1" : null;
      const response = await underwriteReceipt(fixture.env, "underwrite-1");
      const receipt = await response.json() as { status: string; txDigest: string | null };
      assert.equal(receipt.status, status);
      assert.equal(receipt.txDigest, fixture.row.tx_digest);
    }
  });

  it("rejects enqueue when capacity is no longer available", async () => {
    const fixture = await createFixture(false);
    const response = await submitUnderwrite(
      signedRequest(fixture.transactionBytes, fixture.signature),
      fixture.env,
      fixture.quoteStore,
      "underwrite-1",
    );

    assert.equal(response.status, 409);
    assert.equal(fixture.row.status, "failed");
    assert.equal(fixture.queued.length, 0);
  });

  it("does not strand queued state when capacity storage fails", async () => {
    const fixture = await createFixture("throw");
    const response = await submitUnderwrite(
      signedRequest(fixture.transactionBytes, fixture.signature),
      fixture.env,
      fixture.quoteStore,
      "underwrite-1",
    );

    assert.equal(response.status, 503);
    assert.equal(fixture.row.status, "failed");
    assert.equal(fixture.queued.length, 0);
  });
});

function signedRequest(transactionBytes: string, signature: string) {
  return new Request("https://rfq.test/underwrites/underwrite-1/submit", {
    body: JSON.stringify({ signatures: [signature], transactionBytes }),
    method: "POST",
  });
}

async function createFixture(capacityAvailable: boolean | "throw" = true) {
  const tx = new Transaction();
  tx.setSender(seller.toSuiAddress());
  tx.setGasPrice(1);
  tx.setGasBudget(1_000_000);
  tx.setGasPayment([{ digest: "11111111111111111111111111111111", objectId: `0x${"11".repeat(32)}`, version: "1" }]);
  const builtTransaction = await tx.build();
  const transactionBytes = toBase64(builtTransaction);
  const signature = (await seller.signTransaction(builtTransaction)).signature;
  const row = underwriteRow();
  const queued: unknown[] = [];
  let consumed = 0;
  const db = memoryDb(row);
  const quoteStore = {
    fetch: async (request: Request) => {
      if (new URL(request.url).pathname.endsWith("/consume")) consumed += 1;
      if (capacityAvailable === "throw") throw new Error("storage unavailable");
      return capacityAvailable
        ? Response.json({ remainingContractsQtyDecimals: "500000" })
        : Response.json({ error: "quote unavailable" }, { status: 409 });
    },
  };
  const env = {
    BROADCAST_QUEUE: { send: async (message: unknown) => void queued.push(message) },
    DB: db,
    SUI_RPC_URL: "https://fullnode.test",
  };
  return { env, get consumed() { return consumed; }, queued, quoteStore, row, signature, transactionBytes };
}

function underwriteRow(): UnderwriteRow {
  return {
    broadcast_queue_message_id: null, buyer_owner_address: "0xbuyer", buyer_vault_id: "0xvault",
    call_put_marker: 1, cash_premium_per_contract: "10", contracts_qty_decimals: "500000",
    created_at: "now", expiry_unix_ms: Date.now() + 10_000, failure_internal_code: null,
    failure_msg: null, market_id: "0xmarket", order_hash: null, order_payload_json: "{}",
    order_public_key: "key", order_signature: "signature", quote_id: "quote-1",
    quote_payload_json: JSON.stringify({ quote_id: "quote-1" }), quote_signature: "quote-signature",
    series_id: "0xseries", status: "pending", strike_price_decimals: "66000000000",
    taker_address: seller.toSuiAddress(), tx_digest: null, underwrite_id: "underwrite-1", updated_at: "now",
  };
}

function memoryDb(row: UnderwriteRow): D1Database {
  return { prepare: (sql) => ({ bind: (...values) => ({
    all: async <T>() => ({ results: [] as T[] }),
    first: async <T>() => sql.includes("SELECT * FROM underwrites") ? row as T : null,
    run: async () => {
      if (sql.includes("status = 'queued'") && row.status === "pending") {
        row.status = "queued"; row.broadcast_queue_message_id = String(values[0]);
        return { meta: { changes: 1 } };
      }
      if (sql.includes("UPDATE underwrites")) {
        row.status = values[0] as UnderwriteRow["status"];
        row.failure_internal_code = (values[1] as string | null) ?? row.failure_internal_code;
        row.failure_msg = (values[2] as string | null) ?? row.failure_msg;
        row.tx_digest = (values[4] as string | null) ?? row.tx_digest;
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 1 } };
    },
  }) }) };
}
