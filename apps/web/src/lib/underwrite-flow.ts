import { fromBase64, fromHex, toBase64 } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import { verifyTransactionSignature } from "@mysten/sui/verify";

export type OwnedCoin = { balance: string; coinObjectId: string };

type CoinPage = {
  data: OwnedCoin[];
  hasNextPage: boolean;
  nextCursor?: string | null;
};

type CoinClient = {
  getCoins(input: {
    coinType: string;
    cursor?: string | null;
    owner: string;
  }): Promise<CoinPage>;
};

export type PreparedUnderwrite = {
  baseCoinType: string;
  buyerVaultId: string;
  feeRecipient: string;
  marketId: string;
  operationalFee: string;
  packageId: string;
  quoteCoinType: string;
  seriesId: string;
  signedOrderBytes: string;
  status: "pending";
  target: string;
  underwriteId: string;
};

export type UnderwriteReceipt = {
  failure?: { code: string; message: string };
  status: "pending" | "queued" | "submitted" | "confirmed" | "failed";
  txDigest: string | null;
};

export function underwriteAvailability(
  coins: OwnedCoin[] | undefined,
  requiredBalance: bigint,
) {
  if (!coins?.length) return { enabled: false, label: "TEST_BTC NOT FOUND" } as const;
  if (totalCoinBalance(coins) < requiredBalance) {
    return { enabled: false, label: "NOT ENOUGH TEST_BTC" } as const;
  }
  return { enabled: true, label: null } as const;
}

export async function fetchAllCoins(
  client: CoinClient,
  owner: string,
  coinType: string,
) {
  const coins: OwnedCoin[] = [];
  let cursor: string | null | undefined;

  do {
    const page = await client.getCoins({ coinType, cursor, owner });
    coins.push(...page.data);
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);

  return coins;
}

export function totalCoinBalance(coins: OwnedCoin[]) {
  return coins.reduce((total, coin) => total + BigInt(coin.balance), 0n);
}

export function buildUnderwriteTransaction({
  coins,
  collateralAmount,
  prepared,
  seller,
}: {
  coins: OwnedCoin[];
  collateralAmount: bigint;
  prepared: PreparedUnderwrite;
  seller: string;
}) {
  if (coins.length === 0 || totalCoinBalance(coins) < collateralAmount) {
    throw new Error("Not enough TEST_BTC");
  }

  const transaction = new Transaction();
  transaction.setSender(seller);
  const primaryCoin = transaction.object(coins[0].coinObjectId);
  if (coins.length > 1) {
    transaction.mergeCoins(
      primaryCoin,
      coins.slice(1).map((coin) => transaction.object(coin.coinObjectId)),
    );
  }
  const [collateral] = transaction.splitCoins(primaryCoin, [
    transaction.pure.u64(collateralAmount),
  ]);
  transaction.moveCall({
    arguments: [
      transaction.object(prepared.marketId),
      transaction.object(prepared.seriesId),
      transaction.object(prepared.buyerVaultId),
      collateral,
      transaction.pure.vector("u8", [...fromBase64(prepared.signedOrderBytes)]),
      transaction.pure.u64(prepared.operationalFee),
      transaction.pure.address(prepared.feeRecipient),
      transaction.object.clock(),
    ],
    target: prepared.target,
    typeArguments: [prepared.quoteCoinType, prepared.baseCoinType],
  });
  return transaction;
}

export async function prepareUnderwrite(
  rfqApiUrl: string,
  takerAddress: string,
  contractsQtyDecimals: string,
  quote: unknown,
  quoteSignature: string,
  request: typeof fetch = fetch,
) {
  const response = await request(`${rfqApiUrl}/underwrites/prepare`, {
    body: JSON.stringify({ contractsQtyDecimals, quote, quoteSignature, takerAddress }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("Could not prepare this earning transaction");
  return response.json() as Promise<PreparedUnderwrite>;
}

export async function submitUnderwrite(
  rfqApiUrl: string,
  underwriteId: string,
  transactionBytes: string,
  signature: string,
  request: typeof fetch = fetch,
) {
  const response = await request(`${rfqApiUrl}/underwrites/${underwriteId}/submit`, {
    body: JSON.stringify({ signatures: [signature], transactionBytes }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error(await responseError(response, "Could not submit this earning transaction"));
  return response.json() as Promise<{ status: "queued"; underwriteId: string }>;
}

export async function pollUnderwriteReceipt(
  rfqApiUrl: string,
  underwriteId: string,
  request: typeof fetch = fetch,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await request(
      `${rfqApiUrl}/underwrites/${underwriteId}/receipt`,
    );
    if (!response.ok) throw new Error("Could not check transaction status");
    const receipt = await response.json() as UnderwriteReceipt;
    if (receipt.status === "confirmed" || receipt.status === "failed") return receipt;
    await wait(1_000);
  }
  throw new Error("Transaction confirmation is taking longer than expected");
}

export async function executeUnderwrite({
  coins,
  contractsQtyDecimals,
  onStatus,
  quote,
  quoteSignature,
  request = fetch,
  rfqApiUrl,
  seller,
  signTransaction,
  wait,
}: {
  coins: OwnedCoin[];
  contractsQtyDecimals: string;
  onStatus(status: "queued" | "confirmed"): void;
  quote: unknown;
  quoteSignature: string;
  request?: typeof fetch;
  rfqApiUrl: string;
  seller: string;
  signTransaction(transaction: Transaction): Promise<{ bytes: string; signature: string }>;
  wait?: (milliseconds: number) => Promise<void>;
}) {
  const prepared = await prepareUnderwrite(
    rfqApiUrl,
    seller,
    contractsQtyDecimals,
    quote,
    quoteSignature,
    request,
  );
  const transaction = buildUnderwriteTransaction({
    coins,
    collateralAmount: BigInt(contractsQtyDecimals),
    prepared,
    seller,
  });
  const signed = await signTransaction(transaction);
  const normalizedBytes = normalizeTransactionBytes(signed.bytes);
  await validateSignedUnderwriteTransaction(normalizedBytes, signed.signature, seller);
  await submitUnderwrite(
    rfqApiUrl,
    prepared.underwriteId,
    normalizedBytes,
    signed.signature,
    request,
  );
  onStatus("queued");
  const receipt = await pollUnderwriteReceipt(
    rfqApiUrl,
    prepared.underwriteId,
    request,
    wait,
  );
  if (receipt.status === "failed") throw new Error("Transaction failed");
  onStatus("confirmed");
  return receipt;
}

export async function validateSignedUnderwriteTransaction(
  transactionBytes: string,
  signature: string,
  seller: string,
) {
  const bytes = decodeTransactionBytes(transactionBytes);
  const transaction = Transaction.from(bytes);
  if (transaction.getData().sender !== seller) {
    throw new Error("Transaction sender does not match connected wallet");
  }
  await verifyTransactionSignature(bytes, signature, { address: seller });
}

export function normalizeTransactionBytes(transactionBytes: string) {
  return toBase64(decodeTransactionBytes(transactionBytes));
}

function decodeTransactionBytes(transactionBytes: string) {
  const hex = transactionBytes.startsWith("0x") ? transactionBytes.slice(2) : transactionBytes;
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
    return fromHex(hex);
  }
  if (/^\[\s*\d+(?:\s*,\s*\d+)*\s*\]$/.test(transactionBytes)) {
    return byteArrayFromNumbers(JSON.parse(transactionBytes) as number[]);
  }
  if (/^\d+(?:,\d+)*$/.test(transactionBytes)) {
    return byteArrayFromNumbers(transactionBytes.split(",").map((value) => Number(value)));
  }
  try {
    return fromBase64(transactionBytes);
  } catch {
    // Some wallets return URL-safe base64 without padding.
    const base64Url = transactionBytes.replace(/-/g, "+").replace(/_/g, "/");
    const padding = base64Url.length % 4 === 0 ? "" : "=".repeat(4 - (base64Url.length % 4));
    try {
      return fromBase64(base64Url + padding);
    } catch {
      throw new Error("Wallet returned transaction bytes in an unsupported format");
    }
  }
}

function byteArrayFromNumbers(values: number[]) {
  if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    throw new Error("Wallet returned transaction bytes in an unsupported format");
  }
  return Uint8Array.from(values);
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: unknown };
    return typeof payload.error === "string" && payload.error.length > 0
      ? payload.error
      : fallback;
  } catch {
    return fallback;
  }
}
