import assert from "node:assert/strict";
import { describe, it } from "vitest";

import worker, {
  QuoteStore,
  buildHealthPayload,
  getQuoteStore,
  quoteStoreNameFromRequest,
} from "./index";

describe("rfq worker foundation", () => {
  it("returns a health payload with core bindings surfaced", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/health"),
      {
        BROADCAST_QUEUE: { send: async () => undefined },
        DB: {},
        QUOTES: {
          get: () => ({ fetch: async () => new Response(null) }),
          idFromName: (name: string) => name,
        },
      } as never,
    );

    assert.equal(response.status, 200);

    const payload = (await response.json()) as Record<string, unknown>;
    assert.deepEqual(payload, {
      durableObjectBinding: "configured",
      d1Binding: "configured",
      queueBinding: "configured",
      service: "rfq-server",
      status: "ok",
    });
  });

  it("names durable object buckets from request ids", () => {
    assert.equal(
      quoteStoreNameFromRequest("req_1234"),
      "quote-request:req_1234",
    );
  });

  it("creates a durable object stub from the request id baseline", () => {
    const calls: string[] = [];
    const stub = { fetch: async () => new Response(null) };

    const result = getQuoteStore(
      {
        get(id: string) {
          calls.push(`get:${id}`);
          return stub;
        },
        idFromName(name: string) {
          calls.push(`idFromName:${name}`);
          return `id:${name}`;
        },
      },
      "req_1234",
    );

    assert.equal(result, stub);
    assert.deepEqual(calls, [
      "idFromName:quote-request:req_1234",
      "get:id:quote-request:req_1234",
    ]);
  });

  it("stores and reads quote state in the durable object baseline", async () => {
    const storage = new Map<string, unknown>();
    const state = {
      storage: {
        get: async (key: string) => storage.get(key),
        put: async (key: string, value: unknown) => {
          storage.set(key, value);
        },
      },
    };

    const object = new QuoteStore(state as never, {} as never);

    const putResponse = await object.fetch(
      new Request("https://quote-store.internal/state", {
        body: JSON.stringify({
          offerValidUntilUnixMs: 1_800_000_000_000,
          quoteId: "quote-1",
          remainingContractsQtyDecimals: "5",
        }),
        method: "PUT",
      }),
    );

    assert.equal(putResponse.status, 202);

    const getResponse = await object.fetch(
      new Request("https://quote-store.internal/state"),
    );
    assert.equal(getResponse.status, 200);
    assert.deepEqual(await getResponse.json(), {
      offerValidUntilUnixMs: 1_800_000_000_000,
      quoteId: "quote-1",
      remainingContractsQtyDecimals: "5",
    });
  });

  it("builds the same health payload without a request roundtrip", () => {
    assert.deepEqual(
      buildHealthPayload({
        BROADCAST_QUEUE: { send: async () => undefined },
        DB: {},
        QUOTES: {
          get: () => ({ fetch: async () => new Response(null) }),
          idFromName: (name: string) => name,
        },
      } as never),
      {
        durableObjectBinding: "configured",
        d1Binding: "configured",
        queueBinding: "configured",
        service: "rfq-server",
        status: "ok",
      },
    );
  });
});
