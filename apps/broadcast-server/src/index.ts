type BroadcastSubmission = {
  quoteId: string;
  submissionId: string;
  takerAddress: string;
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
  if (!message.quoteId || !message.submissionId || !message.takerAddress) {
    throw new Error("Invalid broadcast submission message");
  }
}

const worker = {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === HEALTH_PATH) {
      return Response.json(buildHealthPayload());
    }

    return new Response("Not found", { status: 404 });
  },

  async queue(batch: QueueBatch) {
    await drainBatch(batch);
  },
};

export default worker;
