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

  it("removes an open position bubble after a full redeem", () => {
    const now = 1_780_000_000_000;
    const tickSize = 1_000_000;
    const openTimestamp = now - 2 * 60 * 60 * 1_000;
    const closeTimestamp = now - 60 * 60 * 1_000;

    const points = buildTradeChartPoints({
      now,
      tickSize,
      trades: [
        {
          checkpoint_timestamp_ms: openTimestamp,
          is_up: true,
          quantity: 100_000_000,
          strike: 73_233_000_000_000,
          type: "mint",
        },
        {
          checkpoint_timestamp_ms: closeTimestamp,
          is_up: true,
          quantity: 100_000_000,
          strike: 73_233_000_000_000,
          type: "redeem",
        },
      ],
      windowStart: now - 24 * 60 * 60 * 1_000,
    });

    assert.equal(points.length, 0);
  });

  it("reduces the original open bucket after a partial redeem", () => {
    const now = 1_780_000_000_000;
    const tickSize = 1_000_000;
    const openTimestamp = now - 2 * 60 * 60 * 1_000;
    const closeTimestamp = now - 60 * 60 * 1_000;

    const points = buildTradeChartPoints({
      now,
      tickSize,
      trades: [
        {
          checkpoint_timestamp_ms: openTimestamp,
          is_up: false,
          quantity: 100_000_000,
          strike: 73_233_000_000_000,
          type: "mint",
        },
        {
          checkpoint_timestamp_ms: closeTimestamp,
          is_up: false,
          quantity: 40_000_000,
          strike: 73_233_000_000_000,
          type: "redeem",
        },
      ],
      windowStart: now - 24 * 60 * 60 * 1_000,
    });

    assert.equal(points.length, 1);
    assert.equal(points[0]?.hour, new Date(openTimestamp).setMinutes(0, 0, 0));
    assert.equal(points[0]?.quantity, 60);
  });

  it("still supports legacy trade_type payloads", () => {
    const now = 1_780_000_000_000;
    const tickSize = 1_000_000;
    const openTimestamp = now - 2 * 60 * 60 * 1_000;
    const closeTimestamp = now - 60 * 60 * 1_000;

    const points = buildTradeChartPoints({
      now,
      tickSize,
      trades: [
        {
          checkpoint_timestamp_ms: openTimestamp,
          is_up: true,
          quantity: 50_000_000,
          strike: 73_233_000_000_000,
          trade_type: "mint",
        },
        {
          checkpoint_timestamp_ms: closeTimestamp,
          is_up: true,
          quantity: 50_000_000,
          strike: 73_233_000_000_000,
          trade_type: "redeem",
        },
      ],
      windowStart: now - 24 * 60 * 60 * 1_000,
    });

    assert.equal(points.length, 0);
  });
});
