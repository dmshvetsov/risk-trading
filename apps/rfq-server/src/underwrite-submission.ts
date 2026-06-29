import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import { verifyTransactionSignature } from "@mysten/sui/verify";

import {
  queuePendingUnderwrite,
  readUnderwrite,
  updateUnderwriteStatus,
  upsertOptionSeries,
} from "./db/queries";
import type { D1Database, UnderwriteStatus } from "./typedefs";
import { TESTNET_UNDERWRITE_CONFIGS } from "./underwrite";

type SubmissionEnv = {
  BROADCAST_QUEUE: { send(message: unknown): Promise<void> };
  DB: D1Database;
  OPERATION_FEE_BPS?: string;
  SUI_RPC_URL?: string;
};

type QuoteStore = { fetch(request: Request): Promise<Response> };

export type UnderwriteSubmission = {
  kind: "underwrite";
  signatures: string[];
  transactionBytes: string;
  underwriteId: string;
};

type QueueMessage = { ack(): void; body: UnderwriteSubmission };

export function isUnderwriteSubmission(value: unknown): value is UnderwriteSubmission {
  if (!value || typeof value !== "object") return false;
  const submission = value as Record<string, unknown>;
  return submission.kind === "underwrite" &&
    typeof submission.underwriteId === "string" &&
    typeof submission.transactionBytes === "string" &&
    Array.isArray(submission.signatures) &&
    submission.signatures.length > 0 &&
    submission.signatures.every((signature) => typeof signature === "string");
}

export async function submitUnderwrite(
  request: Request,
  env: SubmissionEnv,
  quoteStore: QuoteStore,
  underwriteId: string,
) {
  const underwrite = await readUnderwrite(env.DB, underwriteId);
  if (!underwrite) return publicError("Underwrite not found", 404);
  if (underwrite.status !== "pending") {
    return publicError("Underwrite was already submitted", 409);
  }

  let payload: { signatures?: unknown; transactionBytes?: unknown };
  try {
    payload = await request.json();
  } catch {
    return failPendingUnderwrite(
      env.DB,
      underwriteId,
      "invalid_signed_transaction",
      "Invalid signed transaction",
      400,
    );
  }
  if (
    typeof payload.transactionBytes !== "string" ||
    !Array.isArray(payload.signatures) ||
    payload.signatures.length === 0 ||
    !payload.signatures.every((signature) => typeof signature === "string")
  ) {
    return failPendingUnderwrite(
      env.DB,
      underwriteId,
      "invalid_signed_transaction",
      "Invalid signed transaction",
      400,
    );
  }

  try {
    const transactionBytes = fromBase64(payload.transactionBytes);
    const transaction = Transaction.from(transactionBytes);
    if (transaction.getData().sender !== underwrite.taker_address) {
      return failPendingUnderwrite(
        env.DB,
        underwriteId,
        "transaction_sender_mismatch",
        "Transaction sender does not match seller",
        400,
      );
    }
    const sellerChecks = await Promise.allSettled(
      payload.signatures.map((signature) =>
        verifyTransactionSignature(transactionBytes, signature, {
          address: underwrite.taker_address,
        })
      ),
    );
    if (!sellerChecks.some((check) => check.status === "fulfilled")) {
      return failPendingUnderwrite(
        env.DB,
        underwriteId,
        "invalid_seller_transaction_signature",
        "Invalid seller transaction signature",
        400,
      );
    }
  } catch (error) {
    return failPendingUnderwrite(
      env.DB,
      underwriteId,
      "invalid_seller_transaction_signature",
      errorMessage(error),
      400,
    );
  }

  const submission: UnderwriteSubmission = {
    kind: "underwrite",
    signatures: payload.signatures,
    transactionBytes: payload.transactionBytes,
    underwriteId,
  };
  const messageId = crypto.randomUUID();
  if (!await queuePendingUnderwrite(env.DB, underwriteId, messageId)) {
    return publicError("Underwrite was already submitted", 409);
  }

  let capacity: Response;
  try {
    const quote: unknown = JSON.parse(underwrite.quote_payload_json);
    capacity = await quoteStore.fetch(new Request("https://quote-store.internal/consume", {
      body: JSON.stringify({
        contractsQtyDecimals: underwrite.contracts_qty_decimals,
        quote,
        quoteId: underwrite.quote_id,
        quoteSignature: underwrite.quote_signature,
      }),
      method: "POST",
    }));
  } catch (error) {
    await updateUnderwriteStatus(env.DB, underwriteId, "failed", {
      failureInternalCode: "quote_capacity_check_failed",
      failureMsg: errorMessage(error),
    });
    return publicError("Quote capacity could not be reserved", 503);
  }
  if (!capacity.ok) {
    await updateUnderwriteStatus(env.DB, underwriteId, "failed", {
      failureInternalCode: "quote_capacity_unavailable",
      failureMsg: "Quote expired or lacked remaining capacity at submission",
    });
    return publicError("Quote is expired or lacks capacity", 409);
  }

  try {
    await env.BROADCAST_QUEUE.send(submission);
  } catch (error) {
    await updateUnderwriteStatus(env.DB, underwriteId, "failed", {
      failureInternalCode: "queue_send_failed",
      failureMsg: errorMessage(error),
    });
    return publicError("Transaction could not be queued", 503);
  }
  return Response.json({ status: "queued", underwriteId }, { status: 202 });
}

export async function underwriteReceipt(env: Pick<SubmissionEnv, "DB">, underwriteId: string) {
  const underwrite = await readUnderwrite(env.DB, underwriteId);
  if (!underwrite) return publicError("Underwrite not found", 404);
  return Response.json({
    ...(underwrite.status === "failed"
      ? { failure: { code: "execution_failed", message: "Transaction failed" } }
      : {}),
    status: underwrite.status,
    txDigest: underwrite.tx_digest,
    underwriteId,
  });
}

export async function processUnderwriteSubmission(
  message: QueueMessage,
  env: SubmissionEnv,
  request: typeof fetch = fetch,
  onStatus?: (status: UnderwriteStatus) => void,
) {
  if (!env.SUI_RPC_URL) throw new Error("SUI_RPC_URL is not configured");
  const submission = message.body;
  const existing = await readUnderwrite(env.DB, submission.underwriteId);
  if (existing?.status === "confirmed" && existing.tx_digest) {
    await cacheConfirmedOptionSeries(env, submission.underwriteId, existing.tx_digest);
    message.ack();
    return;
  }
  let confirmedDigest: string | null = null;
  try {
    const response = await request(env.SUI_RPC_URL, {
      body: JSON.stringify({
        id: submission.underwriteId,
        jsonrpc: "2.0",
        method: "sui_executeTransactionBlock",
        params: [
          submission.transactionBytes,
          submission.signatures,
          { showEffects: true },
        ],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = await response.json() as {
      error?: { data?: unknown; message?: string };
      result?: { digest?: string; effects?: { status?: { status?: string; error?: string } } };
    };
    if (!response.ok || !payload.result?.digest) {
      throw new Error(rpcErrorMessage(payload.error));
    }
    await persistStatus(env.DB, submission.underwriteId, "submitted", onStatus, {
      txDigest: payload.result.digest,
    });
    if (payload.result.effects?.status?.status !== "success") {
      await persistStatus(env.DB, submission.underwriteId, "failed", onStatus, {
        failureInternalCode: "sui_execution_failed",
        failureMsg: payload.result.effects?.status?.error ?? "Sui execution failed",
        txDigest: payload.result.digest,
      });
    } else {
      await persistStatus(env.DB, submission.underwriteId, "confirmed", onStatus, {
        txDigest: payload.result.digest,
      });
      confirmedDigest = payload.result.digest;
    }
  } catch (error) {
    await persistStatus(env.DB, submission.underwriteId, "failed", onStatus, {
      failureInternalCode: "rpc_execution_failed",
      failureMsg: errorMessage(error),
    });
  }
  if (confirmedDigest) {
    await cacheConfirmedOptionSeries(env, submission.underwriteId, confirmedDigest);
  }
  message.ack();
}

async function cacheConfirmedOptionSeries(
  env: SubmissionEnv,
  underwriteId: string,
  txDigest: string,
) {
  const underwrite = await readUnderwrite(env.DB, underwriteId);
  if (underwrite?.status !== "confirmed") return;
  const chain = TESTNET_UNDERWRITE_CONFIGS.find(
    (candidate) =>
      candidate.callPutMarker === underwrite.call_put_marker &&
      candidate.marketId === underwrite.market_id,
  );
  const maxOperationalFeeBps = parseBasisPoints(env.OPERATION_FEE_BPS);
  if (!chain) throw new Error("Confirmed underwrite uses unsupported option series terms");
  if (maxOperationalFeeBps === null) throw new Error("OPERATION_FEE_BPS is not configured");

  await upsertOptionSeries(env.DB, {
    base_coin_type: chain.baseCoinType,
    base_decimals: 8,
    create_tx_digest: txDigest,
    expiry_unix_ms: underwrite.expiry_unix_ms,
    market_id: underwrite.market_id,
    max_operational_fee_bps: maxOperationalFeeBps,
    option_type: underwrite.call_put_marker,
    quote_coin_type: chain.quoteCoinType,
    quote_decimals: 6,
    series_id: underwrite.series_id,
    strike_price_decimals: underwrite.strike_price_decimals,
    strike_scale: chain.strikeScale,
  });
}

function parseBasisPoints(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 10_000
    ? parsed
    : null;
}

async function persistStatus(
  db: D1Database,
  underwriteId: string,
  status: UnderwriteStatus,
  onStatus: ((status: UnderwriteStatus) => void) | undefined,
  details: Parameters<typeof updateUnderwriteStatus>[3],
) {
  if (!await updateUnderwriteStatus(db, underwriteId, status, details)) {
    throw new Error(`Could not persist ${status} underwrite state`);
  }
  onStatus?.(status);
}

function publicError(error: string, status: number) {
  return Response.json({ error }, { status });
}

async function failPendingUnderwrite(
  db: D1Database,
  underwriteId: string,
  failureInternalCode: string,
  failureMsg: string,
  status: number,
) {
  await updateUnderwriteStatus(db, underwriteId, "failed", {
    failureInternalCode,
    failureMsg,
  });
  return publicError(failureMsg, status);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown execution failure";
}

function rpcErrorMessage(error: { data?: unknown; message?: string } | undefined) {
  const message = error?.message ?? "Sui transaction execution failed";
  if (typeof error?.data === "string" && error.data.length > 0) {
    return `${message}: ${error.data}`;
  }
  return message;
}
