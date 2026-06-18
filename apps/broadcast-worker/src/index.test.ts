import assert from "node:assert/strict";
import { describe, it } from "vitest";

import worker, {
  buildHealthPayload,
  createFinalityAwaiter,
  drainBatch,
} from "./index";

describe("broadcast worker foundation", () => {
  it("returns a health payload that advertises sequential queue processing", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/health"),
      {} as never,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      queueConsumer: "configured",
      queueMode: "single-flight-scaffold",
      service: "broadcast-server",
      status: "ok",
    });
  });

  it("acks queue messages only after the finality awaiter resolves", async () => {
    const acked: string[] = [];
    const steps: string[] = [];

    await drainBatch({
      messages: [
        {
          ack() {
            acked.push("tx-1");
          },
          body: {
            quoteId: "quote-1",
            submissionId: "tx-1",
            takerAddress: "0xabc",
          },
        },
      ],
      onSubmitAndWaitForFinality: createFinalityAwaiter(async (message) => {
        steps.push(`wait:${message.submissionId}`);
      }),
    });

    assert.deepEqual(steps, ["wait:tx-1"]);
    assert.deepEqual(acked, ["tx-1"]);
  });

  it("builds the same health payload without a fetch call", () => {
    assert.deepEqual(buildHealthPayload(), {
      queueConsumer: "configured",
      queueMode: "single-flight-scaffold",
      service: "broadcast-server",
      status: "ok",
    });
  });
});
