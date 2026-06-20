type LegacyBroadcastSubmission = {
  quoteId: string;
  submissionId: string;
  takerAddress: string;
};

type CreateMakerVaultSubmission = {
  kind: "create-maker-vault";
  orderEndpointUrl: string | null;
  ownerAddress: string;
  quoteCoinType: string;
  quoteEndpointUrl: string | null;
  signature: string;
  submissionId: string;
  transactionBytes: string;
};

type BroadcastSubmission = LegacyBroadcastSubmission | CreateMakerVaultSubmission;

type Env = {
  BROADCAST_RECEIPT_TOKEN?: string;
  RFQ_SERVER?: { fetch(request: Request): Promise<Response> };
  SUI_RPC_URL?: string;
};

type QueueMessage = {
  ack(): void;
  body: BroadcastSubmission;
};

type QueueBatch = {
  messages: QueueMessage[];
  onSubmitAndWaitForFinality?: (message: BroadcastSubmission) => Promise<void>;
};

const HEALTH_PATH = "/health";
const READY_MARKET_ID = "BTC-USDC-WBTC";

export function buildHealthPayload() {
  return {
    queueConsumer: "configured",
    queueMode: "single-flight-scaffold",
    service: "broadcast-server",
    status: "ok",
  };
}

export function createFinalityAwaiter(
  submitAndWaitForFinality: (message: BroadcastSubmission) => Promise<void>,
) {
  return async (message: BroadcastSubmission) => {
    await submitAndWaitForFinality(message);
  };
}

export async function drainBatch(batch: QueueBatch) {
  const awaitFinality =
    batch.onSubmitAndWaitForFinality ??
    createFinalityAwaiter(async () => undefined);

  for (const message of batch.messages) {
    validateSubmission(message.body);
    await awaitFinality(message.body);
    message.ack();
  }
}

function validateSubmission(message: BroadcastSubmission) {
  if (
    "kind" in message
      ? !message.ownerAddress ||
        !message.quoteCoinType ||
        !message.signature ||
        !message.submissionId ||
        !message.transactionBytes
      : !message.quoteId || !message.submissionId || !message.takerAddress
  ) {
    throw new Error("Invalid broadcast submission message");
  }
}

export function createSuiFinalityAwaiter(
  env: Env,
  request: typeof fetch = fetch,
) {
  return createFinalityAwaiter(async (message) => {
    if (!("kind" in message) || message.kind !== "create-maker-vault") {
      return;
    }
    if (
      !env.SUI_RPC_URL ||
      !env.RFQ_SERVER ||
      !env.BROADCAST_RECEIPT_TOKEN
    ) {
      throw new Error("Maker vault broadcast bindings are not configured");
    }

    const rpcResponse = await request(env.SUI_RPC_URL, {
      body: JSON.stringify({
        id: message.submissionId,
        jsonrpc: "2.0",
        method: "sui_executeTransactionBlock",
        params: [
          message.transactionBytes,
          [message.signature],
          {
            showEffects: true,
            showEvents: true,
            showObjectChanges: true,
          },
          "WaitForLocalExecution",
        ],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const rpcPayload = (await rpcResponse.json()) as {
      error?: { message?: string };
      result?: unknown;
    };
    if (!rpcResponse.ok || !rpcPayload.result) {
      throw new Error(rpcPayload.error?.message ?? "Sui transaction execution failed");
    }

    const receiptResponse = await env.RFQ_SERVER.fetch(
      new Request("https://rfq-server/api/internal/maker/vaults/receipts", {
        body: JSON.stringify({ receipt: rpcPayload.result, submission: message }),
        headers: {
          authorization: `Bearer ${env.BROADCAST_RECEIPT_TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    if (!receiptResponse.ok) {
      throw new Error(`RFQ receipt callback failed with ${receiptResponse.status}`);
    }
  });
}

const worker = {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === HEALTH_PATH) {
      return Response.json(buildHealthPayload());
    }

    return new Response("Not found", { status: 404 });
  },

  async queue(batch: QueueBatch, env: Env) {
    await drainBatch({
      ...batch,
      onSubmitAndWaitForFinality:
        batch.onSubmitAndWaitForFinality ?? createSuiFinalityAwaiter(env),
    });
  },
};

export default worker;
