import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { buildTradeChartPoints } from "./open-positions-chart";

describe("OpenPositionsChart trade normalization", () => {
  it("uses checkpoint_timestamp_ms from predict-server trades", () => {
    const now = 1_780_000_000_000;
    const tickSize = 1_000_000;
    const tradeTimestamp = now - 60_000;

    const points = buildTradeChartPoints({
      now,
      tickSize,
      trades: [
        {
          checkpoint_timestamp_ms: tradeTimestamp,
          is_up: true,
          quantity: 2_000_000,
          strike: 73_233_000_000_000,
        },
      ],
      windowStart: now - 24 * 60 * 60 * 1_000,
    });

    assert.equal(points.length, 1);
    assert.equal(points[0]?.hour, new Date(tradeTimestamp).setMinutes(0, 0, 0));
    assert.equal(points[0]?.quantity, 2);
  });
});
