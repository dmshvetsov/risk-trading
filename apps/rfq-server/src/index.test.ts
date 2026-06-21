import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, vi } from "vitest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import worker, {
  QuoteStore,
  buildHealthPayload,
  drainBatch,
  getQuoteStore,
  quoteStoreNameFromRequest,
} from "./index";

type MakerVaultRow = {
  created_at: string;
  deleted_at: string | null;
  enabled: number;
  order_endpoint_url: string | null;
  owner_address: string;
  quote_coin_symbol: string;
  quote_coin_type: string;
  quote_endpoint_url: string | null;
  updated_at: string;
  vault_id: string;
};

class FakeStatement {
  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    return {
      all: async () => this.db.all(this.sql, values),
      first: async () => this.db.first(this.sql, values),
      run: async () => this.db.run(this.sql, values),
    };
  }
}

class FakeD1Database {
  rows = new Map<string, MakerVaultRow>();

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async all(sql: string, values: unknown[]) {
    if (!sql.includes("FROM makers_vaults")) {
      throw new Error(`Unsupported all() SQL: ${sql}`);
    }

    const owner = values[0];
    const result = [...this.rows.values()]
      .filter((row) => row.owner_address === owner)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));

    return { results: result };
  }

  async first(sql: string, values: unknown[]) {
    if (!sql.includes("FROM makers_vaults")) {
      throw new Error(`Unsupported first() SQL: ${sql}`);
    }

    const [vaultId] = values;
    return this.rows.get(String(vaultId)) ?? null;
  }

  async run(sql: string, values: unknown[]) {
    if (sql.includes("INSERT INTO makers_vaults")) {
      const [
        vaultId,
        ownerAddress,
        quoteCoinType,
        quoteCoinSymbol,
        enabled,
        quoteEndpointUrl,
        orderEndpointUrl,
        createdAt,
        updatedAt,
      ] = values as [
        string,
        string,
        string,
        string,
        number,
        string | null,
        string | null,
        string,
        string,
      ];

      this.rows.set(vaultId, {
        vault_id: vaultId,
        owner_address: ownerAddress,
        quote_coin_type: quoteCoinType,
        quote_coin_symbol: quoteCoinSymbol,
        enabled,
        quote_endpoint_url: quoteEndpointUrl,
        order_endpoint_url: orderEndpointUrl,
        created_at: createdAt,
        updated_at: updatedAt,
        deleted_at: null,
      });

      return { success: true };
    }

    if (sql.includes("SET quote_endpoint_url = ?")) {
      const [quoteEndpointUrl, orderEndpointUrl, updatedAt, vaultId] =
        values as [string | null, string | null, string, string];
      const row = this.rows.get(vaultId);

      if (!row) {
        return { meta: { changes: 0 }, success: true };
      }

      row.quote_endpoint_url = quoteEndpointUrl;
      row.order_endpoint_url = orderEndpointUrl;
      row.updated_at = updatedAt;
      return { meta: { changes: 1 }, success: true };
    }

    if (sql.includes("SET enabled = 0")) {
      const [deletedAt, updatedAt, vaultId] = values as [string, string, string];
      const row = this.rows.get(vaultId);

      if (!row) {
        return { meta: { changes: 0 }, success: true };
      }

      row.enabled = 0;
      row.deleted_at = deletedAt;
      row.updated_at = updatedAt;
      return { meta: { changes: 1 }, success: true };
    }

    throw new Error(`Unsupported run() SQL: ${sql}`);
  }
}

function createEnv(db = new FakeD1Database()) {
  const makerKey = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9));
  return {
    BROADCAST_QUEUE: { send: async () => undefined },
    DB: db,
    MAKER_STUB_PRIVATE_KEY: makerKey.getSecretKey(),
    OTP_PACKAGE_ID: "0xotp",
    QUOTES: {
      get: () => ({ fetch: async () => new Response(null) }),
      idFromName: (name: string) => name,
    },
    TX_VALIDATOR: {
      verifyCreateVaultDigest: async (_digest: string) => ({
        ownerAddress: "0xmaker",
        quoteCoinType:
          "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
        vaultId: "0xvault-1",
      }),
      verifyCloseVaultDigest: async (_digest: string, vaultId: string) => ({
        ownerAddress: "0xmaker",
        vaultId,
      }),
    },
    VAULT_CONFIG_AUTH: {
      verifyOwnerProof: async (proof: {
        message: string;
        ownerAddress: string;
        signature: string;
      }) => proof.signature === "valid-signature" && proof.ownerAddress === "0xmaker",
    },
  } as never;
}

function createdVaultReceipt(packageId = "0xotp") {
  return {
    digest: "digest-1",
    effects: { status: { status: "success" } },
    events: [
      {
        packageId,
        transactionModule: "buyer_vault",
        type: `${packageId}::buyer_vault::BuyerVaultCreated`,
        parsedJson: {
          owner: "0xmaker",
          quote_coin_type: {
            name: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
          },
          vault_id: "0xvault-1",
        },
      },
    ],
    objectChanges: [
      {
        objectId: "0xvault-1",
        objectType: `${packageId}::buyer_vault::BuyerVault<0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC>`,
        type: "created",
      },
    ],
  };
}

describe("rfq worker foundation", () => {
  it("returns a health payload with core bindings surfaced", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/health"),
      createEnv(),
    );

    assert.equal(response.status, 200);

    const payload = (await response.json()) as Record<string, unknown>;
    assert.deepEqual(payload, {
      durableObjectBinding: "configured",
      d1Binding: "configured",
      queueBinding: "configured",
      service: "rfq-server",
      status: "ok",
      supportedCoins: ["USDC"],
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
    assert.deepEqual(buildHealthPayload(createEnv() as never), {
      durableObjectBinding: "configured",
      d1Binding: "configured",
      queueBinding: "configured",
      service: "rfq-server",
      status: "ok",
      supportedCoins: ["USDC"],
    });
  });
});

describe("shared quote request path", () => {
  it("generates and stores an actionable input-dependent stub quote", async () => {
    const stored: unknown[] = [];
    const env = createEnv() as ReturnType<typeof createEnv> & {
      QUOTES: {
        get(id: string): { fetch(request: Request): Promise<Response> };
        idFromName(name: string): string;
      };
    };
    env.QUOTES = {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (request) => {
          stored.push(await request.json());
          return new Response(null, { status: 202 });
        },
      }),
    };

    const requestQuote = (strikePriceDecimals: string) =>
      worker.fetch(
        new Request("https://example.com/api/quotes", {
          body: JSON.stringify({
            request: {
              call_put_marker: 1,
              cash_token_address: "0x0::usdc::USDC",
              cash_token_decimals: 6,
              collateral_token_address: "0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC",
              collateral_token_decimals: 8,
              contracts_qty_decimals: "5000000",
              expiry_unix_ms: Date.now() + 30 * 86_400_000,
              long_short_marker: 2,
              oracle_base_symbol: "BTC",
              oracle_feed_id: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
              oracle_quote_symbol: "USDC",
              strike_price_decimals: strikePriceDecimals,
            },
          }),
          method: "POST",
        }),
        env,
      );

    const firstResponse = await requestQuote("68000000000");
    const secondResponse = await requestQuote("75000000000");
    assert.equal(firstResponse.status, 201);
    assert.equal(secondResponse.status, 201);

    const first = (await firstResponse.json()) as {
      quote: Record<string, unknown>;
    };
    const second = (await secondResponse.json()) as {
      quote: Record<string, unknown>;
    };
    assert.equal(first.quote.domain, "otp:quote:v1");
    assert.notEqual(
      first.quote.cash_premium_per_contract,
      second.quote.cash_premium_per_contract,
    );
    assert.equal(stored.length, 2);
  });

  it("does not return a quote when durable storage fails", async () => {
    const env = createEnv() as ReturnType<typeof createEnv> & {
      QUOTES: {
        get(id: string): { fetch(request: Request): Promise<Response> };
        idFromName(name: string): string;
      };
    };
    env.QUOTES = {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => new Response(null, { status: 500 }) }),
    };

    const response = await worker.fetch(
      new Request("https://example.com/api/quotes", {
        body: JSON.stringify({ request: {
          call_put_marker: 1, cash_token_address: "0x0::usdc::USDC",
          cash_token_decimals: 6,
          collateral_token_address: "0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC",
          collateral_token_decimals: 8, contracts_qty_decimals: "5000000",
          expiry_unix_ms: Date.now() + 86_400_000, long_short_marker: 2,
          oracle_base_symbol: "BTC",
          oracle_feed_id: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
          oracle_quote_symbol: "USDC", strike_price_decimals: "68000000000",
        }}), method: "POST",
      }),
      env,
    );

    assert.equal(response.status, 503);
  });
});

describe("cash-secured put quote request", () => {
  it("uses the shared local provider and storage path with input-dependent premiums", async () => {
    vi.stubGlobal("fetch", vi.fn(() => {
      throw new Error("quote path must not call maker HTTP endpoints");
    }));
    const stored: unknown[] = [];
    const env = createEnv() as ReturnType<typeof createEnv> & {
      QUOTES: {
        get(id: string): { fetch(request: Request): Promise<Response> };
        idFromName(name: string): string;
      };
    };
    env.QUOTES = {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (request) => {
          stored.push(await request.json());
          return new Response(null, { status: 202 });
        },
      }),
    };

    const requestQuote = (strikePriceDecimals: string) =>
      worker.fetch(new Request("https://example.com/api/quotes", {
        body: JSON.stringify({ request: {
          call_put_marker: 2, cash_token_address: "0x0::usdc::USDC",
          cash_token_decimals: 6, collateral_token_address: "0x0::usdc::USDC",
          collateral_token_decimals: 6,
          contracts_qty_decimals: "500000",
          expiry_unix_ms: Date.now() + 30 * 86_400_000, long_short_marker: 2,
          oracle_base_symbol: "BTC",
          oracle_feed_id: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
          oracle_quote_symbol: "USDC", strike_price_decimals: strikePriceDecimals,
        }}), method: "POST",
      }), env);

    const firstResponse = await requestQuote("68000000000");
    const secondResponse = await requestQuote("75000000000");
    assert.equal(firstResponse.status, 201);
    assert.equal(secondResponse.status, 201);
    const first = (await firstResponse.json()) as { quote: Record<string, unknown> };
    const second = (await secondResponse.json()) as { quote: Record<string, unknown> };
    assert.equal(first.quote.call_put_marker, 2);
    assert.notEqual(first.quote.cash_premium_per_contract, second.quote.cash_premium_per_contract);
    assert.equal(stored.length, 2);
    assert.equal(vi.mocked(fetch).mock.calls.length, 0);
    vi.unstubAllGlobals();
  });

  it("rejects put quantity below the 0.005 BTC minimum", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/quotes", {
      body: JSON.stringify({ request: {
        call_put_marker: 2, cash_token_address: "0x0::usdc::USDC",
        cash_token_decimals: 6, collateral_token_address: "0x0::usdc::USDC",
        collateral_token_decimals: 6, contracts_qty_decimals: "1",
        expiry_unix_ms: Date.now() + 30 * 86_400_000, long_short_marker: 2,
        oracle_base_symbol: "BTC",
        oracle_feed_id: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
        oracle_quote_symbol: "USDC", strike_price_decimals: "68000000000",
      }}), method: "POST",
    }), createEnv());

    assert.equal(response.status, 400);
  });

  it("rejects quantities that are not aligned to the 0.005 BTC step", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/quotes", {
      body: JSON.stringify({ request: {
        call_put_marker: 1,
        cash_token_address: "0x0::usdc::USDC",
        cash_token_decimals: 6,
        collateral_token_address: "0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC",
        collateral_token_decimals: 8,
        contracts_qty_decimals: "750000",
        expiry_unix_ms: Date.now() + 30 * 86_400_000,
        long_short_marker: 2,
        oracle_base_symbol: "BTC",
        oracle_feed_id: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
        oracle_quote_symbol: "USDC",
        strike_price_decimals: "68000000000",
      }}),
      method: "POST",
    }), createEnv());

    assert.equal(response.status, 400);
  });
});

describe("quote capacity consumption", () => {
  it("decrements capacity atomically and rejects excess consumption", async () => {
    const values = new Map<string, unknown>();
    const object = new QuoteStore({
      storage: {
        get: async (key) => values.get(key) as never,
        put: async (key, value) => void values.set(key, value),
      },
    }, createEnv());
    const storedQuote = {
      quote_id: "quote-capacity",
      offer_valid_until_unix_ms: Date.now() + 10_000,
    };
    await object.fetch(new Request("https://internal/state", {
      body: JSON.stringify({
        offerValidUntilUnixMs: storedQuote.offer_valid_until_unix_ms,
        quote: storedQuote,
        quoteId: storedQuote.quote_id,
        quoteSignature: "quote-signature",
        remainingContractsQtyDecimals: "10",
      }),
      method: "PUT",
    }));

    const consume = (quantity: string) => object.fetch(new Request("https://internal/consume", {
      body: JSON.stringify({
        contractsQtyDecimals: quantity,
        quote: storedQuote,
        quoteId: storedQuote.quote_id,
        quoteSignature: "quote-signature",
      }),
      method: "POST",
    }));
    const accepted = await consume("6");
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).remainingContractsQtyDecimals, "4");
    assert.equal((await consume("5")).status, 409);
  });
});

describe("maker vault APIs", () => {
  it("responds to CORS preflight for maker APIs", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/maker/vaults", {
        headers: {
          "access-control-request-method": "POST",
          origin: "http://localhost:5173",
        },
        method: "OPTIONS",
      }),
      createEnv(),
    );

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.match(
      String(response.headers.get("access-control-allow-methods")),
      /POST/i,
    );
  });

  it("returns supported quote coins from server config", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/api/maker/supported-coins", {
        headers: { origin: "http://localhost:5173" },
      }),
      createEnv(),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(await response.json(), {
      supportedCoins: [
        {
          coinType: "0x0::usdc::USDC",
          network: "localnet",
          symbol: "USDC",
        },
        {
          coinType:
            "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
          network: "testnet",
          symbol: "USDC",
        },
        {
          coinType:
            "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
          network: "mainnet",
          symbol: "USDC",
        },
      ],
    });
  });

  it("registers a created vault from a verified digest", async () => {
    const db = new FakeD1Database();
    const response = await worker.fetch(
      new Request("https://example.com/api/maker/vaults", {
        body: JSON.stringify({ createVaultDigest: "digest-1" }),
        method: "POST",
      }),
      createEnv(db),
    );

    assert.equal(response.status, 201);
    const payload = (await response.json()) as { vault: Record<string, unknown> };
    assert.equal(payload.vault.deletedAt, null);
    assert.equal(payload.vault.enabled, true);
    assert.equal(payload.vault.orderEndpointUrl, null);
    assert.equal(payload.vault.ownerAddress, "0xmaker");
    assert.equal(payload.vault.quoteCoinSymbol, "USDC");
    assert.equal(
      payload.vault.quoteCoinType,
      "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
    );
    assert.equal(payload.vault.quoteEndpointUrl, null);
    assert.equal(payload.vault.vaultId, "0xvault-1");
    assert.match(String(payload.vault.createdAt), /^\d{4}-\d{2}-\d{2}T/);
    assert.match(String(payload.vault.updatedAt), /^\d{4}-\d{2}-\d{2}T/);
  });

  it("queues a signed create transaction and persists it after Sui finality", async () => {
    const db = new FakeD1Database();
    const queued: unknown[] = [];
    const env = createEnv(db) as ReturnType<typeof createEnv> & {
      BROADCAST_QUEUE: { send(message: unknown): Promise<void> };
    };
    env.BROADCAST_QUEUE = { send: async (message) => void queued.push(message) };

    const submitResponse = await worker.fetch(
      new Request("https://example.com/api/maker/vaults/submissions", {
        body: JSON.stringify({
          ownerAddress: "0xmaker",
          orderEndpointUrl: "https://maker.example/orders",
          quoteCoinType:
            "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
          quoteEndpointUrl: "https://maker.example/quotes",
          signature: "wallet-signature",
          transactionBytes: "signed-transaction-bytes",
        }),
        method: "POST",
      }),
      env,
    );

    assert.equal(submitResponse.status, 202);
    assert.equal(queued.length, 1);

    const steps: string[] = [];
    await drainBatch(
      {
        messages: [{
          ack: () => void steps.push("ack"),
          body: queued[0],
        }],
      },
      { ...env, SUI_RPC_URL: "https://fullnode.example" },
      async () => {
        steps.push("execute");
        return Response.json({ result: createdVaultReceipt() });
      },
    );

    assert.deepEqual(steps, ["execute", "ack"]);
    assert.equal(db.rows.get("0xvault-1")?.quote_endpoint_url, "https://maker.example/quotes");
    assert.equal(db.rows.get("0xvault-1")?.order_endpoint_url, "https://maker.example/orders");
  });

  it("does not acknowledge a receipt created by another package", async () => {
    let acked = false;
    await assert.rejects(() =>
      drainBatch(
        {
          messages: [{
            ack: () => { acked = true; },
            body: {
            kind: "create-maker-vault",
            ownerAddress: "0xmaker",
            orderEndpointUrl: "https://maker.example/orders",
            quoteCoinType:
              "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
            quoteEndpointUrl: "https://maker.example/quotes",
            signature: "wallet-signature",
            submissionId: "submission-1",
            transactionBytes: "signed-transaction-bytes",
          },
          }],
        },
        { ...createEnv(), SUI_RPC_URL: "https://fullnode.example" },
        async () => Response.json({ result: createdVaultReceipt("0xattacker") }),
      ),
      /expected BuyerVault/,
    );
    assert.equal(acked, false);
  });

  it("lists maker vaults from the database for one owner", async () => {
    const db = new FakeD1Database();
    db.rows.set("0xvault-1", {
      created_at: "2026-06-19T10:00:00.000Z",
      deleted_at: null,
      enabled: 1,
      order_endpoint_url: "https://maker.example/orders",
      owner_address: "0xmaker",
      quote_coin_symbol: "USDC",
      quote_coin_type:
        "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
      quote_endpoint_url: "https://maker.example/quotes",
      updated_at: "2026-06-19T10:00:00.000Z",
      vault_id: "0xvault-1",
    });

    const response = await worker.fetch(
      new Request("https://example.com/api/maker/vaults?ownerAddress=0xmaker"),
      createEnv(db),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      vaults: [
        {
          createdAt: "2026-06-19T10:00:00.000Z",
          deletedAt: null,
          enabled: true,
          orderEndpointUrl: "https://maker.example/orders",
          ownerAddress: "0xmaker",
          quoteCoinSymbol: "USDC",
          quoteCoinType:
            "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
          quoteEndpointUrl: "https://maker.example/quotes",
          updatedAt: "2026-06-19T10:00:00.000Z",
          vaultId: "0xvault-1",
        },
      ],
    });
  });

  it("updates only quote and order endpoint URLs for an active owner vault", async () => {
    const db = new FakeD1Database();
    db.rows.set("0xvault-1", {
      created_at: "2026-06-19T10:00:00.000Z",
      deleted_at: null,
      enabled: 1,
      order_endpoint_url: null,
      owner_address: "0xmaker",
      quote_coin_symbol: "USDC",
      quote_coin_type:
        "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
      quote_endpoint_url: null,
      updated_at: "2026-06-19T10:00:00.000Z",
      vault_id: "0xvault-1",
    });

    const response = await worker.fetch(
      new Request("https://example.com/api/maker/vaults/0xvault-1", {
        body: JSON.stringify({
          orderEndpointUrl: "https://maker.example/orders",
          ownerProof: {
            message: "otp:maker-config:v1:0xvault-1",
            ownerAddress: "0xmaker",
            signature: "valid-signature",
          },
          quoteEndpointUrl: "https://maker.example/quotes",
        }),
        method: "PATCH",
      }),
      createEnv(db),
    );

    assert.equal(response.status, 200);
    assert.equal(db.rows.get("0xvault-1")?.quote_endpoint_url, "https://maker.example/quotes");
    assert.equal(db.rows.get("0xvault-1")?.order_endpoint_url, "https://maker.example/orders");
  });

  it("soft deletes and disables a vault after a verified close digest", async () => {
    const db = new FakeD1Database();
    db.rows.set("0xvault-1", {
      created_at: "2026-06-19T10:00:00.000Z",
      deleted_at: null,
      enabled: 1,
      order_endpoint_url: "https://maker.example/orders",
      owner_address: "0xmaker",
      quote_coin_symbol: "USDC",
      quote_coin_type:
        "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
      quote_endpoint_url: "https://maker.example/quotes",
      updated_at: "2026-06-19T10:00:00.000Z",
      vault_id: "0xvault-1",
    });

    const response = await worker.fetch(
      new Request("https://example.com/api/maker/vaults/0xvault-1/close", {
        body: JSON.stringify({
          closeVaultDigest: "digest-2",
          ownerAddress: "0xmaker",
        }),
        method: "POST",
      }),
      createEnv(db),
    );

    assert.equal(response.status, 200);
    assert.equal(db.rows.get("0xvault-1")?.enabled, 0);
    assert.match(String(db.rows.get("0xvault-1")?.deleted_at), /^\d{4}-\d{2}-\d{2}T/);
    assert.equal((await response.json()).vault.enabled, false);
  });
});

describe("makers_vaults migration", () => {
  it("creates the makers_vaults table with required fields", () => {
    const sql = readFileSync(
      resolve(import.meta.dirname, "../migrations/0001_baseline.sql"),
      "utf8",
    );

    assert.match(sql, /CREATE TABLE IF NOT EXISTS makers_vaults/i);
    assert.match(sql, /vault_id TEXT PRIMARY KEY/i);
    assert.match(sql, /owner_address TEXT NOT NULL/i);
    assert.match(sql, /quote_coin_type TEXT NOT NULL/i);
    assert.match(sql, /quote_coin_symbol TEXT NOT NULL/i);
    assert.match(sql, /enabled INTEGER NOT NULL DEFAULT 0/i);
    assert.match(sql, /quote_endpoint_url TEXT/i);
    assert.match(sql, /order_endpoint_url TEXT/i);
    assert.match(sql, /deleted_at TEXT/i);
  });
});

describe("queue configuration", () => {
  it("limits every queue consumer to one in-flight transaction", () => {
    const config = readFileSync(
      resolve(import.meta.dirname, "../wrangler.toml"),
      "utf8",
    );

    assert.equal(config.match(/max_concurrency = 1/g)?.length, 3);
  });
});
