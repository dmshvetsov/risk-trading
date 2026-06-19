import { supportedQuoteCoins } from "./supported-quote-coins";

type D1Result<T> = {
  results?: T[];
  success?: boolean;
  meta?: {
    changes?: number;
  };
};

type D1Statement = {
  bind(...values: unknown[]): {
    all<T>(): Promise<D1Result<T>>;
    first<T>(): Promise<T | null>;
    run(): Promise<D1Result<never>>;
  };
};

type D1Database = {
  prepare(sql: string): D1Statement;
};

type TxValidationResult = {
  ownerAddress: string;
  quoteCoinType?: string;
  vaultId: string;
};

type VaultConfigProof = {
  message: string;
  ownerAddress: string;
  signature: string;
};

export interface Env {
  BROADCAST_QUEUE: {
    send(message: unknown): Promise<void>;
  };
  DB: D1Database;
  OTP_PACKAGE_ID?: string;
  QUOTES: DurableObjectNamespace<QuoteStoreStub>;
  TX_VALIDATOR?: {
    verifyCloseVaultDigest(
      digest: string,
      vaultId: string,
      packageId: string | undefined,
    ): Promise<TxValidationResult>;
    verifyCreateVaultDigest(
      digest: string,
      packageId: string | undefined,
    ): Promise<TxValidationResult>;
  };
  VAULT_CONFIG_AUTH?: {
    verifyOwnerProof(proof: VaultConfigProof): Promise<boolean>;
  };
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

const HEALTH_PATH = "/health";
const STATE_KEY = "quote-state";
const MAKER_SUPPORTED_COINS_PATH = "/api/maker/supported-coins";
const MAKER_VAULTS_PATH = "/api/maker/vaults";

export function buildHealthPayload(env: Partial<Env>) {
  return {
    durableObjectBinding: env.QUOTES ? "configured" : "missing",
    d1Binding: env.DB ? "configured" : "missing",
    queueBinding: env.BROADCAST_QUEUE ? "configured" : "missing",
    service: "rfq-server",
    status: "ok",
    supportedCoins: [...new Set(supportedQuoteCoins.map((coin) => coin.symbol))],
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

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function nowIsoString() {
  return new Date().toISOString();
}

function normalizeUrl(url: unknown) {
  if (typeof url !== "string" || url.trim().length === 0) {
    return null;
  }

  return url.trim();
}

function toMakerVault(row: MakerVaultRow) {
  return {
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    enabled: row.enabled === 1,
    orderEndpointUrl: row.order_endpoint_url,
    ownerAddress: row.owner_address,
    quoteCoinSymbol: row.quote_coin_symbol,
    quoteCoinType: row.quote_coin_type,
    quoteEndpointUrl: row.quote_endpoint_url,
    updatedAt: row.updated_at,
    vaultId: row.vault_id,
  };
}

function getQuoteCoinSymbol(quoteCoinType: string) {
  const match = supportedQuoteCoins.find((coin) => coin.coinType === quoteCoinType);
  return match?.symbol ?? "UNKNOWN";
}

async function readVault(db: D1Database, vaultId: string) {
  return db
    .prepare(
      `SELECT vault_id, owner_address, quote_coin_type, quote_coin_symbol,
              enabled, quote_endpoint_url, order_endpoint_url, created_at,
              updated_at, deleted_at
         FROM makers_vaults
        WHERE vault_id = ?`,
    )
    .bind(vaultId)
    .first<MakerVaultRow>();
}

async function listVaults(db: D1Database, ownerAddress: string) {
  const result = await db
    .prepare(
      `SELECT vault_id, owner_address, quote_coin_type, quote_coin_symbol,
              enabled, quote_endpoint_url, order_endpoint_url, created_at,
              updated_at, deleted_at
         FROM makers_vaults
        WHERE owner_address = ?
        ORDER BY created_at ASC`,
    )
    .bind(ownerAddress)
    .all<MakerVaultRow>();

  return result.results ?? [];
}

async function insertVault(
  db: D1Database,
  input: {
    ownerAddress: string;
    quoteCoinType: string;
    vaultId: string;
  },
) {
  const timestamp = nowIsoString();

  await db
    .prepare(
      `INSERT INTO makers_vaults (
         vault_id,
         owner_address,
         quote_coin_type,
         quote_coin_symbol,
         enabled,
         quote_endpoint_url,
         order_endpoint_url,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.vaultId,
      input.ownerAddress,
      input.quoteCoinType,
      getQuoteCoinSymbol(input.quoteCoinType),
      1,
      null,
      null,
      timestamp,
      timestamp,
    )
    .run();

  return readVault(db, input.vaultId);
}

async function updateVaultEndpoints(
  db: D1Database,
  vaultId: string,
  quoteEndpointUrl: string | null,
  orderEndpointUrl: string | null,
) {
  const result = await db
    .prepare(
      `UPDATE makers_vaults
          SET quote_endpoint_url = ?,
              order_endpoint_url = ?,
              updated_at = ?
        WHERE vault_id = ?`,
    )
    .bind(quoteEndpointUrl, orderEndpointUrl, nowIsoString(), vaultId)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

async function softDeleteVault(db: D1Database, vaultId: string) {
  const timestamp = nowIsoString();
  const result = await db
    .prepare(
      `UPDATE makers_vaults
          SET enabled = 0,
              deleted_at = ?,
              updated_at = ?
        WHERE vault_id = ?`,
    )
    .bind(timestamp, timestamp, vaultId)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

async function registerCreatedVault(request: Request, env: Env) {
  const payload = (await request.json()) as {
    createVaultDigest?: string;
  };

  if (!payload.createVaultDigest || !env.TX_VALIDATOR) {
    return json({ error: "createVaultDigest is required" }, 400);
  }

  const result = await env.TX_VALIDATOR.verifyCreateVaultDigest(
    payload.createVaultDigest,
    env.OTP_PACKAGE_ID,
  );

  if (!result.quoteCoinType) {
    return json({ error: "quoteCoinType is missing from verified digest" }, 400);
  }

  if (!supportedQuoteCoins.some((coin) => coin.coinType === result.quoteCoinType)) {
    return json({ error: "quote coin is not supported" }, 400);
  }

  const existing = await readVault(env.DB, result.vaultId);
  if (existing) {
    return json({ vault: toMakerVault(existing) }, 200);
  }

  const vault = await insertVault(env.DB, {
    ownerAddress: result.ownerAddress,
    quoteCoinType: result.quoteCoinType,
    vaultId: result.vaultId,
  });

  return json(
    {
      vault: toMakerVault(vault as MakerVaultRow),
    },
    201,
  );
}

async function handleMakerVaults(request: Request, env: Env) {
  if (request.method === "GET") {
    const ownerAddress = new URL(request.url).searchParams.get("ownerAddress");
    if (!ownerAddress) {
      return json({ error: "ownerAddress is required" }, 400);
    }

    const vaults = await listVaults(env.DB, ownerAddress);
    return json({ vaults: vaults.map(toMakerVault) });
  }

  if (request.method === "POST") {
    return registerCreatedVault(request, env);
  }

  return new Response("Method not allowed", { status: 405 });
}

async function handleVaultUpdate(request: Request, env: Env, vaultId: string) {
  const current = await readVault(env.DB, vaultId);
  if (!current) {
    return json({ error: "vault not found" }, 404);
  }

  if (current.deleted_at) {
    return json({ error: "closed vaults cannot be edited" }, 409);
  }

  const payload = (await request.json()) as {
    ownerProof?: VaultConfigProof;
    orderEndpointUrl?: string | null;
    quoteEndpointUrl?: string | null;
  };

  if (!payload.ownerProof || !env.VAULT_CONFIG_AUTH) {
    return json({ error: "signed owner proof is required" }, 400);
  }

  if (payload.ownerProof.ownerAddress !== current.owner_address) {
    return json({ error: "owner mismatch" }, 403);
  }

  const proofIsValid = await env.VAULT_CONFIG_AUTH.verifyOwnerProof(
    payload.ownerProof,
  );
  if (!proofIsValid) {
    return json({ error: "invalid owner proof" }, 403);
  }

  await updateVaultEndpoints(
    env.DB,
    vaultId,
    normalizeUrl(payload.quoteEndpointUrl),
    normalizeUrl(payload.orderEndpointUrl),
  );

  const updated = await readVault(env.DB, vaultId);
  return json({ vault: toMakerVault(updated as MakerVaultRow) });
}

async function handleVaultClose(request: Request, env: Env, vaultId: string) {
  const current = await readVault(env.DB, vaultId);
  if (!current) {
    return json({ error: "vault not found" }, 404);
  }

  if (current.deleted_at) {
    return json({ vault: toMakerVault(current) });
  }

  const payload = (await request.json()) as {
    closeVaultDigest?: string;
    ownerAddress?: string;
  };

  if (
    !payload.closeVaultDigest ||
    !payload.ownerAddress ||
    payload.ownerAddress !== current.owner_address ||
    !env.TX_VALIDATOR
  ) {
    return json({ error: "valid ownerAddress and closeVaultDigest are required" }, 400);
  }

  const verified = await env.TX_VALIDATOR.verifyCloseVaultDigest(
    payload.closeVaultDigest,
    vaultId,
    env.OTP_PACKAGE_ID,
  );

  if (verified.ownerAddress !== current.owner_address || verified.vaultId !== vaultId) {
    return json({ error: "verified close digest does not match vault owner" }, 403);
  }

  await softDeleteVault(env.DB, vaultId);
  const updated = await readVault(env.DB, vaultId);
  return json({ vault: toMakerVault(updated as MakerVaultRow) });
}

const worker = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === HEALTH_PATH) {
      return Response.json(buildHealthPayload(env));
    }

    if (url.pathname === MAKER_SUPPORTED_COINS_PATH) {
      return json({ supportedCoins: supportedQuoteCoins });
    }

    if (url.pathname === MAKER_VAULTS_PATH) {
      return handleMakerVaults(request, env);
    }

    const vaultMatch = url.pathname.match(/^\/api\/maker\/vaults\/([^/]+)$/);
    if (vaultMatch && request.method === "PATCH") {
      return handleVaultUpdate(request, env, decodeURIComponent(vaultMatch[1] ?? ""));
    }

    const closeMatch = url.pathname.match(/^\/api\/maker\/vaults\/([^/]+)\/close$/);
    if (closeMatch && request.method === "POST") {
      return handleVaultClose(request, env, decodeURIComponent(closeMatch[1] ?? ""));
    }

    return new Response("Not found", { status: 404 });
  },
};

export default worker;
