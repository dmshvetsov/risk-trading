import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  insertVault,
  listVaults,
  readVault,
  softDeleteVault,
  updateVaultEndpoints,
} from "./db/queries";
import { supportedQuoteCoins } from "./supported-quote-coins";
import {
  createStubQuote,
  type QuoteRequest,
} from "./stub-quote-provider";
import type { D1Database, MakerVaultRow } from "./typedefs";

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
  BROADCAST_SERVER?: { fetch(request: Request): Promise<Response> };
  BROADCAST_RECEIPT_TOKEN?: string;
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

export type CreateMakerVaultSubmission = {
  kind: "create-maker-vault";
  orderEndpointUrl: string | null;
  ownerAddress: string;
  quoteCoinType: string;
  quoteEndpointUrl: string | null;
  signature: string;
  submissionId: string;
  transactionBytes: string;
};

type TransactionReceipt = {
  digest?: string;
  effects?: { status?: { status?: string } };
  events?: Array<{
    packageId?: string;
    parsedJson?: Record<string, unknown>;
    transactionModule?: string;
    type?: string;
  }>;
  objectChanges?: Array<{
    objectId?: string;
    objectType?: string;
    type?: string;
  }>;
};

const HEALTH_PATH = "/health";
const STATE_KEY = "quote-state";
const MAKER_SUPPORTED_COINS_PATH = "/api/maker/supported-coins";
const MAKER_VAULTS_PATH = "/api/maker/vaults";
const MAKER_VAULT_SUBMISSIONS_PATH = "/api/maker/vaults/submissions";
const MAKER_VAULT_RECEIPTS_PATH = "/api/internal/maker/vaults/receipts";
const QUOTES_PATH = "/api/quotes";
const BTC_USD_FEED_ID =
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const WBTC_TYPE =
  "0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC";

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

function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function buildHealthPayload(env: Env) {
  return {
    durableObjectBinding: env.QUOTES ? "configured" : "missing",
    d1Binding: env.DB ? "configured" : "missing",
    queueBinding: env.BROADCAST_QUEUE ? "configured" : "missing",
    service: "rfq-server",
    status: "ok",
    supportedCoins: [...new Set(supportedQuoteCoins.map((coin) => coin.symbol))],
  };
}

function isQuoteRequest(value: unknown): value is QuoteRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<Record<keyof QuoteRequest, unknown>>;
  const quantity = typeof request.contracts_qty_decimals === "string" &&
    /^\d+$/.test(request.contracts_qty_decimals)
    ? BigInt(request.contracts_qty_decimals)
    : null;
  const strike = typeof request.strike_price_decimals === "string" &&
    /^\d+$/.test(request.strike_price_decimals)
    ? BigInt(request.strike_price_decimals)
    : null;
  const contractsStep = 500_000n;
  const isCoveredCall =
    request.call_put_marker === 1 &&
    request.collateral_token_address === WBTC_TYPE &&
    request.collateral_token_decimals === 8 &&
    quantity !== null &&
    quantity >= contractsStep &&
    quantity % contractsStep === 0n;
  const isCashSecuredPut =
    request.call_put_marker === 2 &&
    request.collateral_token_address === request.cash_token_address &&
    request.collateral_token_decimals === 6 &&
    quantity !== null &&
    quantity >= contractsStep &&
    quantity % contractsStep === 0n;
  return (
    (isCoveredCall || isCashSecuredPut) &&
    request.long_short_marker === 2 &&
    request.oracle_base_symbol === "BTC" &&
    request.oracle_quote_symbol === "USDC" &&
    request.oracle_feed_id === BTC_USD_FEED_ID &&
    typeof request.cash_token_address === "string" &&
    supportedQuoteCoins.some(
      (coin) => coin.coinType === request.cash_token_address,
    ) &&
    request.cash_token_decimals === 6 &&
    strike !== null &&
    strike > 0n &&
    typeof request.expiry_unix_ms === "number" &&
    request.expiry_unix_ms > Date.now()
  );
}

async function requestQuote(request: Request, env: Env) {
  const payload = (await request.json()) as { request?: unknown };
  if (!isQuoteRequest(payload.request)) {
    return jsonResponse({ error: "invalid quote request" }, 400);
  }

  const quote = createStubQuote(payload.request);
  const store = getQuoteStore(env.QUOTES, quote.quote_id);
  const storeResponse = await store.fetch(
    new Request("https://quote-store.internal/state", {
      body: JSON.stringify({
        offerValidUntilUnixMs: quote.offer_valid_until_unix_ms,
        quoteId: quote.quote_id,
        remainingContractsQtyDecimals:
          quote.offer_valid_until_total_contracts_qty_decimals,
      }),
      method: "PUT",
    }),
  );
  if (!storeResponse.ok) {
    return jsonResponse({ error: "quote could not be stored" }, 503);
  }

  return jsonResponse(
    { quote },
    201,
  );
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

function isCreateMakerVaultSubmission(
  input: unknown,
): input is CreateMakerVaultSubmission {
  if (!input || typeof input !== "object") {
    return false;
  }

  const value = input as Record<string, unknown>;
  return (
    value.kind === "create-maker-vault" &&
    typeof value.ownerAddress === "string" &&
    typeof value.quoteCoinType === "string" &&
    typeof value.signature === "string" &&
    typeof value.submissionId === "string" &&
    typeof value.transactionBytes === "string"
  );
}

async function submitCreateVault(request: Request, env: Env) {
  const payload = (await request.json()) as Partial<CreateMakerVaultSubmission>;
  const quoteEndpointUrl = normalizeUrl(payload.quoteEndpointUrl);
  const orderEndpointUrl = normalizeUrl(payload.orderEndpointUrl);

  if (
    !payload.ownerAddress ||
    !payload.quoteCoinType ||
    !payload.signature ||
    !payload.transactionBytes ||
    !quoteEndpointUrl ||
    !orderEndpointUrl ||
    !supportedQuoteCoins.some((coin) => coin.coinType === payload.quoteCoinType)
  ) {
    return jsonResponse(
      {
        error:
          "valid signed transaction, quote coin, and endpoints are required",
      },
      400,
    );
  }

  const submission: CreateMakerVaultSubmission = {
    kind: "create-maker-vault",
    orderEndpointUrl,
    ownerAddress: payload.ownerAddress,
    quoteCoinType: payload.quoteCoinType,
    quoteEndpointUrl,
    signature: payload.signature,
    submissionId: crypto.randomUUID(),
    transactionBytes: payload.transactionBytes,
  };
  await env.BROADCAST_QUEUE.send(submission);
  return jsonResponse({ submissionId: submission.submissionId }, 202);
}

function parseCreatedVault(
  receipt: TransactionReceipt,
  submission: CreateMakerVaultSubmission,
  packageId: string,
) {
  if (receipt.effects?.status?.status !== "success") {
    return null;
  }

  const event = receipt.events?.find(
    (candidate) =>
      candidate.packageId === packageId &&
      candidate.transactionModule === "buyer_vault" &&
      candidate.type === `${packageId}::buyer_vault::BuyerVaultCreated`,
  );
  const vaultId = event?.parsedJson?.vault_id;
  const ownerAddress = event?.parsedJson?.owner;
  const quoteCoinTypeValue = event?.parsedJson?.quote_coin_type;
  const quoteCoinType =
    typeof quoteCoinTypeValue === "string"
      ? quoteCoinTypeValue
      : quoteCoinTypeValue &&
          typeof quoteCoinTypeValue === "object" &&
          "name" in quoteCoinTypeValue &&
          typeof quoteCoinTypeValue.name === "string"
        ? quoteCoinTypeValue.name
        : null;
  if (
    typeof vaultId !== "string" ||
    ownerAddress !== submission.ownerAddress ||
    quoteCoinType !== submission.quoteCoinType
  ) {
    return null;
  }

  const expectedObjectType = `${packageId}::buyer_vault::BuyerVault<${submission.quoteCoinType}>`;
  const createdObject = receipt.objectChanges?.find(
    (change) =>
      change.type === "created" &&
      change.objectId === vaultId &&
      change.objectType === expectedObjectType,
  );
  return createdObject ? { ownerAddress, quoteCoinType, vaultId } : null;
}

async function persistCreateVaultReceipt(request: Request, env: Env) {
  if (
    !env.BROADCAST_RECEIPT_TOKEN ||
    request.headers.get("authorization") !==
      `Bearer ${env.BROADCAST_RECEIPT_TOKEN}`
  ) {
    return jsonResponse({ error: "unauthorized receipt callback" }, 401);
  }

  const payload = (await request.json()) as {
    receipt?: TransactionReceipt;
    submission?: unknown;
  };
  if (
    !payload.receipt ||
    !isCreateMakerVaultSubmission(payload.submission) ||
    !env.OTP_PACKAGE_ID
  ) {
    return jsonResponse({ error: "invalid create vault receipt" }, 400);
  }

  const verified = parseCreatedVault(
    payload.receipt,
    payload.submission,
    env.OTP_PACKAGE_ID,
  );
  if (!verified) {
    return jsonResponse(
      { error: "receipt does not contain the expected BuyerVault" },
      400,
    );
  }

  const existing = await readVault(env.DB, verified.vaultId);
  if (existing) {
    return jsonResponse({ vault: toMakerVault(existing) });
  }

  const vault = await insertVault(env.DB, {
    ...verified,
    orderEndpointUrl: payload.submission.orderEndpointUrl,
    quoteEndpointUrl: payload.submission.quoteEndpointUrl,
  });
  return jsonResponse({ vault: toMakerVault(vault as MakerVaultRow) }, 201);
}

async function registerCreatedVault(request: Request, env: Env) {
  const payload = (await request.json()) as {
    createVaultDigest?: string;
  };

  if (!payload.createVaultDigest || !env.TX_VALIDATOR) {
    return jsonResponse({ error: "createVaultDigest is required" }, 400);
  }

  const result = await env.TX_VALIDATOR.verifyCreateVaultDigest(
    payload.createVaultDigest,
    env.OTP_PACKAGE_ID,
  );

  if (!result.quoteCoinType) {
    return jsonResponse(
      { error: "quoteCoinType is missing from verified digest" },
      400,
    );
  }

  if (
    !supportedQuoteCoins.some((coin) => coin.coinType === result.quoteCoinType)
  ) {
    return jsonResponse({ error: "quote coin is not supported" }, 400);
  }

  const existing = await readVault(env.DB, result.vaultId);
  if (existing) {
    return jsonResponse({ vault: toMakerVault(existing) }, 200);
  }

  const vault = await insertVault(env.DB, {
    ownerAddress: result.ownerAddress,
    quoteCoinType: result.quoteCoinType,
    vaultId: result.vaultId,
  });

  return jsonResponse(
    {
      vault: toMakerVault(vault as MakerVaultRow),
    },
    201,
  );
}

async function handleVaultUpdate(request: Request, env: Env, vaultId: string) {
  const current = await readVault(env.DB, vaultId);
  if (!current) {
    return jsonResponse({ error: "vault not found" }, 404);
  }

  if (current.deleted_at) {
    return jsonResponse({ error: "closed vaults cannot be edited" }, 409);
  }

  const payload = (await request.json()) as {
    ownerProof?: VaultConfigProof;
    orderEndpointUrl?: string | null;
    quoteEndpointUrl?: string | null;
  };

  if (!payload.ownerProof || !env.VAULT_CONFIG_AUTH) {
    return jsonResponse({ error: "signed owner proof is required" }, 400);
  }

  if (payload.ownerProof.ownerAddress !== current.owner_address) {
    return jsonResponse({ error: "owner mismatch" }, 403);
  }

  const proofIsValid = await env.VAULT_CONFIG_AUTH.verifyOwnerProof(
    payload.ownerProof,
  );
  if (!proofIsValid) {
    return jsonResponse({ error: "invalid owner proof" }, 403);
  }

  await updateVaultEndpoints(
    env.DB,
    vaultId,
    normalizeUrl(payload.quoteEndpointUrl),
    normalizeUrl(payload.orderEndpointUrl),
  );

  const updated = await readVault(env.DB, vaultId);
  return jsonResponse({ vault: toMakerVault(updated as MakerVaultRow) });
}

async function handleVaultClose(request: Request, env: Env, vaultId: string) {
  const current = await readVault(env.DB, vaultId);
  if (!current) {
    return jsonResponse({ error: "vault not found" }, 404);
  }

  if (current.deleted_at) {
    return jsonResponse({ vault: toMakerVault(current) });
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
    return jsonResponse(
      { error: "valid ownerAddress and closeVaultDigest are required" },
      400,
    );
  }

  const verified = await env.TX_VALIDATOR.verifyCloseVaultDigest(
    payload.closeVaultDigest,
    vaultId,
    env.OTP_PACKAGE_ID,
  );

  if (
    verified.ownerAddress !== current.owner_address ||
    verified.vaultId !== vaultId
  ) {
    return jsonResponse(
      { error: "verified close digest does not match vault owner" },
      403,
    );
  }

  await softDeleteVault(env.DB, vaultId);
  const updated = await readVault(env.DB, vaultId);
  return jsonResponse({ vault: toMakerVault(updated as MakerVaultRow) });
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  "/api/*",
  cors({
    allowHeaders: ["authorization", "content-type"],
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
    origin: "*",
  }),
);

app.get(HEALTH_PATH, (c) => Response.json(buildHealthPayload(c.env)));

app.post(QUOTES_PATH, (c) => requestQuote(c.req.raw, c.env));
app.all(QUOTES_PATH, () => new Response("Method not allowed", { status: 405 }));

app.get(MAKER_SUPPORTED_COINS_PATH, () =>
  jsonResponse({ supportedCoins: supportedQuoteCoins }),
);

app.get(MAKER_VAULTS_PATH, async (c) => {
  const ownerAddress = c.req.query("ownerAddress");
  if (!ownerAddress) {
    return jsonResponse({ error: "ownerAddress is required" }, 400);
  }

  const vaults = await listVaults(c.env.DB, ownerAddress);
  return jsonResponse({ vaults: vaults.map(toMakerVault) });
});

app.post(MAKER_VAULTS_PATH, (c) => registerCreatedVault(c.req.raw, c.env));
app.all(
  MAKER_VAULTS_PATH,
  () => new Response("Method not allowed", { status: 405 }),
);

app.post(MAKER_VAULT_SUBMISSIONS_PATH, (c) =>
  submitCreateVault(c.req.raw, c.env),
);
app.all(
  MAKER_VAULT_SUBMISSIONS_PATH,
  () => new Response("Method not allowed", { status: 405 }),
);

app.post(MAKER_VAULT_RECEIPTS_PATH, (c) =>
  persistCreateVaultReceipt(c.req.raw, c.env),
);
app.all(
  MAKER_VAULT_RECEIPTS_PATH,
  () => new Response("Method not allowed", { status: 405 }),
);

app.patch("/api/maker/vaults/:vaultId", (c) =>
  handleVaultUpdate(c.req.raw, c.env, c.req.param("vaultId")),
);
app.all(
  "/api/maker/vaults/:vaultId",
  () => new Response("Method not allowed", { status: 405 }),
);

app.post("/api/maker/vaults/:vaultId/close", (c) =>
  handleVaultClose(c.req.raw, c.env, c.req.param("vaultId")),
);
app.all(
  "/api/maker/vaults/:vaultId/close",
  () => new Response("Method not allowed", { status: 405 }),
);

export default app;
