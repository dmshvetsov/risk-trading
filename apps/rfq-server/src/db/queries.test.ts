import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createUnderwrite,
  queuePendingUnderwrite,
  readUnderwrite,
  updateUnderwriteStatus,
} from "./queries";
import type { D1Database, D1Result } from "../typedefs";

describe("underwrite persistence", () => {
  it("stores pending execution state and its audit record", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = recordingDb(calls);

    await createUnderwrite(db, underwriteInput());

    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /INSERT INTO underwrites/);
    assert.equal(calls[0].values.at(-1), "pending");
    assert.match(calls[1].sql, /INSERT INTO underwrite_audit/);
    assert.deepEqual(calls[1].values.slice(1), ["underwrite-1", "pending"]);
  });

  it("updates lifecycle details and appends an audit record", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = recordingDb(calls, 1);

    assert.equal(
      await updateUnderwriteStatus(db, "underwrite-1", "confirmed", {
        txDigest: "digest-1",
      }),
      true,
    );

    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /UPDATE underwrites/);
    assert.equal(calls[0].values[0], "confirmed");
    assert.equal(calls[0].values[4], "digest-1");
    assert.deepEqual(calls[1].values.slice(1), ["underwrite-1", "confirmed"]);
  });

  it("does not audit a missing execution", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = recordingDb(calls, 0);

    assert.equal(
      await updateUnderwriteStatus(db, "missing", "failed"),
      false,
    );
    assert.equal(calls.length, 1);
  });

  it("reads an execution by id", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = recordingDb(calls);

    await readUnderwrite(db, "underwrite-1");

    assert.match(calls[0].sql, /SELECT \* FROM underwrites/);
    assert.deepEqual(calls[0].values, ["underwrite-1"]);
  });

  it("claims only a pending execution before queueing", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = recordingDb(calls, 1);

    assert.equal(await queuePendingUnderwrite(db, "underwrite-1", "message-1"), true);
    assert.match(calls[0].sql, /status = 'queued'/);
    assert.match(calls[0].sql, /status = 'pending'/);
    assert.deepEqual(calls[1].values.slice(1), ["underwrite-1", "queued"]);
  });
});

function recordingDb(
  calls: Array<{ sql: string; values: unknown[] }>,
  changes = 0,
): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            all: async <T>() => ({ results: [] as T[] }),
            first: async <T>() => {
              calls.push({ sql, values });
              return null as T | null;
            },
            run: async (): Promise<D1Result<never>> => {
              calls.push({ sql, values });
              return { meta: { changes }, success: true };
            },
          };
        },
      };
    },
  };
}

function underwriteInput() {
  return {
    buyer_owner_address: "0xbuyer",
    buyer_vault_id: "0xvault",
    call_put_marker: 1 as const,
    cash_premium_per_contract: "25000000",
    contracts_qty_decimals: "1000000",
    expiry_unix_ms: 1_800_000_000_000,
    market_id: "0xmarket",
    order_payload_json: "{}",
    order_public_key: "public-key",
    order_signature: "signature",
    quote_id: "quote-1",
    quote_payload_json: "{}",
    series_id: "0xseries",
    strike_price_decimals: "100000000000",
    taker_address: "0xtaker",
    underwrite_id: "underwrite-1",
  };
}
