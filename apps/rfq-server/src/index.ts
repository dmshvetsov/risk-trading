import { Hono } from "hono";
import { cors } from "hono/cors";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  insertVault,
  listVaults,
  readUnderwrite,
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
import { prepareUnderwrite, signQuote } from "./underwrite";
import {
  isUnderwriteSubmission,
  processUnderwriteSubmission,
  submitUnderwrite,
  underwriteReceipt,
} from "./underwrite-submission";

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
  MAKER_STUB_PRIVATE_KEY?: string;
  /** fee that is taken by the application to fund business operation in basis points, e.g. 258 = 2.58% */
  OPERATION_FEE_BPS?: string;
  /** sui address that receives operational fees */
  OPERATION_FEE_TREASURY?: string;
  OTP_PACKAGE_ID?: string;
  QUOTES: DurableObjectNamespace<QuoteStoreStub>;
  SUI_RPC_URL?: string;
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
  quote: ReturnType<typeof createStubQuote>;
  quoteId: string;
  quoteSignature: string;
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

type QueueMessage = {
  ack(): void;
  body: unknown;
};

type QueueBatch = {
  messages: QueueMessage[];
};

const HEALTH_PATH = "/health";
const STATE_KEY = "quote-state";
const MAKER_SUPPORTED_COINS_PATH = "/api/maker/supported-coins";
const MAKER_VAULTS_PATH = "/api/maker/vaults";
const MAKER_VAULT_SUBMISSIONS_PATH = "/api/maker/vaults/submissions";
const QUOTES_PATH = "/api/quotes";
const BTC_USD_FEED_ID =
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const LOCAL_USDC_TYPE = "0x0::usdc::USDC";
const TEST_USDC_TYPE =
  "0x7751ad73b7801f4bab9a18541e03cfed2199caccc8ffe36c368126833f2974e3::test_usdc::TEST_USDC";
const MAINNET_USDC_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
const WBTC_TYPE =
  "0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC";
const TEST_BTC_TYPE =
  "0xced54dfe52c5b65a36379260763116faf14bbb0f1c7e0be0a4650d023b0c579e::test_btc::TEST_BTC";

const coveredCallMarkets = new Map([
  [LOCAL_USDC_TYPE, WBTC_TYPE],
  [TEST_USDC_TYPE, TEST_BTC_TYPE],
  [MAINNET_USDC_TYPE, WBTC_TYPE],
]);

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

    if (request.method === "POST") {
      const current = await this.state.storage.get(STATE_KEY);
      const payload = await request.json() as {
        contractsQtyDecimals?: string;
        quote?: unknown;
        quoteId?: string;
        quoteSignature?: string;
      };
      const quantity = typeof payload.contractsQtyDecimals === "string" && /^\d+$/.test(payload.contractsQtyDecimals)
        ? BigInt(payload.contractsQtyDecimals)
        : 0n;
      const remaining = current ? BigInt(current.remainingContractsQtyDecimals) : 0n;
      if (
        !current ||
        current.quoteId !== payload.quoteId ||
        JSON.stringify(current.quote) !== JSON.stringify(payload.quote) ||
        current.quoteSignature !== payload.quoteSignature ||
        current.offerValidUntilUnixMs <= Date.now() ||
        quantity === 0n ||
        quantity > remaining
      ) {
        return Response.json({ error: "quote unavailable" }, { status: 409 });
      }
      if (new URL(request.url).pathname.endsWith("/consume")) {
        const next = {
          ...current,
          remainingContractsQtyDecimals: (remaining - quantity).toString(),
        };
        await this.state.storage.put(STATE_KEY, next);
        return Response.json(next);
      }
      return Response.json(current);
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
    typeof request.cash_token_address === "string" &&
    request.collateral_token_address === coveredCallMarkets.get(request.cash_token_address) &&
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

  if (!env.MAKER_STUB_PRIVATE_KEY) {
    return jsonResponse({ error: "maker quote signing is unavailable" }, 503);
  }
  let quote: ReturnType<typeof createStubQuote>;
  let quoteSignature: string;
  try {
    const keypair = Ed25519Keypair.fromSecretKey(env.MAKER_STUB_PRIVATE_KEY);
    quote = createStubQuote(payload.request, Date.now(), keypair.toSuiAddress());
    quoteSignature = (await signQuote(quote, env.MAKER_STUB_PRIVATE_KEY)).signature;
  } catch {
    return jsonResponse({ error: "maker quote signing is unavailable" }, 503);
  }
  const store = getQuoteStore(env.QUOTES, quote.quote_id);
  const storeResponse = await store.fetch(
    new Request("https://quote-store.internal/state", {
      body: JSON.stringify({
        offerValidUntilUnixMs: quote.offer_valid_until_unix_ms,
        quote,
        quoteId: quote.quote_id,
        quoteSignature,
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
    { quote, quote_signature: quoteSignature },
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

async function persistCreateVaultReceipt(
  receipt: TransactionReceipt,
  submission: CreateMakerVaultSubmission,
  env: Env,
) {
  if (!env.OTP_PACKAGE_ID) {
    throw new Error("OTP_PACKAGE_ID is not configured");
  }
  const verified = parseCreatedVault(
    receipt,
    submission,
    env.OTP_PACKAGE_ID,
  );
  if (!verified) {
    throw new Error("Receipt does not contain the expected BuyerVault");
  }

  const existing = await readVault(env.DB, verified.vaultId);
  if (existing) {
    return existing;
  }

  return insertVault(env.DB, {
    ...verified,
    orderEndpointUrl: submission.orderEndpointUrl,
    quoteEndpointUrl: submission.quoteEndpointUrl,
  });
}

export async function drainBatch(
  batch: QueueBatch,
  env: Env,
  request: typeof fetch = fetch,
) {
  if (!env.SUI_RPC_URL) {
    throw new Error("SUI_RPC_URL is not configured");
  }

  for (const message of batch.messages) {
    if (isUnderwriteSubmission(message.body)) {
      await processUnderwriteSubmission(
        { ack: () => message.ack(), body: message.body },
        env,
        request,
      );
      continue;
    }
    if (!isCreateMakerVaultSubmission(message.body)) {
      throw new Error("Invalid broadcast submission message");
    }

    const response = await request(env.SUI_RPC_URL, {
      body: JSON.stringify({
        id: message.body.submissionId,
        jsonrpc: "2.0",
        method: "sui_executeTransactionBlock",
        params: [
          message.body.transactionBytes,
          [message.body.signature],
          { showEffects: true, showEvents: true, showObjectChanges: true },
        ],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as {
      error?: { message?: string };
      result?: TransactionReceipt;
    };
    if (!response.ok || !payload.result) {
      throw new Error(
        payload.error?.message ?? "Sui transaction execution failed",
      );
    }

    await persistCreateVaultReceipt(payload.result, message.body, env);
    message.ack();
  }
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
app.use(
  "/underwrites/*",
  cors({
    allowHeaders: ["authorization", "content-type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    origin: "*",
  }),
);

app.get(HEALTH_PATH, (c) => Response.json(buildHealthPayload(c.env)));

app.post(QUOTES_PATH, (c) => requestQuote(c.req.raw, c.env));
app.all(QUOTES_PATH, () => new Response("Method not allowed", { status: 405 }));

app.post("/underwrites/prepare", async (c) => {
  let quoteId = "";
  try {
    const payload = await c.req.raw.clone().json() as { quote?: { quote_id?: unknown } };
    quoteId = typeof payload.quote?.quote_id === "string" ? payload.quote.quote_id : "";
  } catch {
    // The handler below returns the public validation error.
  }
  return prepareUnderwrite(
    c.req.raw,
    c.env,
    getQuoteStore(c.env.QUOTES, quoteId),
  );
});

app.post("/underwrites/:underwriteId/submit", async (c) => {
  const underwriteId = c.req.param("underwriteId");
  const underwrite = await readUnderwrite(c.env.DB, underwriteId);
  if (!underwrite) return jsonResponse({ error: "Underwrite not found" }, 404);
  return submitUnderwrite(
    c.req.raw,
    c.env,
    getQuoteStore(c.env.QUOTES, underwrite.quote_id),
    underwriteId,
  );
});

app.get("/underwrites/:underwriteId/receipt", (c) =>
  underwriteReceipt(c.env, c.req.param("underwriteId")),
);

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

const worker = {
  fetch: app.fetch,
  queue(batch: QueueBatch, env: Env) {
    return drainBatch(batch, env);
  },
};

export default worker;
