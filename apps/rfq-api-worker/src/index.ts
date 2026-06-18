export interface Env {
  BROADCAST_QUEUE: {
    send(message: unknown): Promise<void>;
  };
  DB: object;
  QUOTES: DurableObjectNamespace<QuoteStoreStub>;
}

type DurableObjectNamespace<TStub> = {
  get(id: string): TStub;
  idFromName(name: string): string;
};

type QuoteStoreStub = {
  fetch(request: Request): Promise<Response>;
};

type QuoteState = {
  offerValidUntilUnixMs: number;
  quoteId: string;
  remainingContractsQtyDecimals: string;
};

const HEALTH_PATH = "/health";
const STATE_KEY = "quote-state";

export function buildHealthPayload(env: Partial<Env>) {
  return {
    durableObjectBinding: env.QUOTES ? "configured" : "missing",
    d1Binding: env.DB ? "configured" : "missing",
    queueBinding: env.BROADCAST_QUEUE ? "configured" : "missing",
    service: "rfq-server",
    status: "ok",
  };
}

export function quoteStoreNameFromRequest(requestId: string) {
  return `quote-request:${requestId}`;
}

export function getQuoteStore(
  namespace: DurableObjectNamespace<QuoteStoreStub>,
  requestId: string,
) {
  const name = quoteStoreNameFromRequest(requestId);
  return namespace.get(namespace.idFromName(name));
}

export class QuoteStore {
  constructor(
    private readonly state: {
      storage: {
        get(key: string): Promise<QuoteState | undefined>;
        put(key: string, value: QuoteState): Promise<void>;
      };
    },
    private readonly _env: Env,
  ) {}

  async fetch(request: Request) {
    if (request.method === "PUT") {
      const payload = (await request.json()) as QuoteState;
      await this.state.storage.put(STATE_KEY, payload);
      return new Response(null, { status: 202 });
    }

    const payload = await this.state.storage.get(STATE_KEY);
    return Response.json(payload ?? null);
  }
}

const worker = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === HEALTH_PATH) {
      return Response.json(buildHealthPayload(env));
    }

    return new Response("Not found", { status: 404 });
  },
};

export default worker;
