type Env = {
  ASSETS: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  MARKET_DEMAND_CACHE?: KvNamespace;
};

type KvNamespace = {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
};

type MarketDemandExample = {
  action: "buy" | "sell";
  asset: "BTC" | "ETH";
  amount: number;
  strike: number;
  daysToExpiry: number;
  premium: number;
  instrumentName: string;
};

type DeriveInstrument = {
  instrument_name: string;
  is_active: boolean;
  base_currency: string;
  option_details: {
    expiry: number;
    strike: string;
    option_type: "C" | "P";
  } | null;
};

type DeriveTicker = {
  B?: string;
  b?: string;
  I?: string;
};

const DERIVE_API_URL = "https://api-demo.lyra.finance";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_TTL_SECONDS = CACHE_TTL_MS / 1000;
const CACHE_RETENTION_SECONDS = CACHE_TTL_SECONDS * 2;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MARKET_DEMAND_CACHE_KEY = "market-demand-examples";
const MARKET_DEMAND_CACHE_CONTROL =
  "public, max-age=3600, stale-while-revalidate=300";

type CachedMarketDemand = {
  fetchedAt: number;
  examples: MarketDemandExample[];
};

let localCachedMarketDemand:
  | {
      fetchedAt: number;
      examples: MarketDemandExample[];
    }
  | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/market-demand") {
      return marketDemandResponse(env);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    try {
      await refreshMarketDemandCache(env, Date.now());
    } catch (error) {
      console.error("Failed to refresh market demand cache", error);
    }
  },
};

export async function marketDemandResponse(env?: Env): Promise<Response> {
  const now = Date.now();
  const cached = await readMarketDemandCache(env);

  if (cached && isFreshCache(cached, now)) {
    return jsonResponse(cached.examples);
  }

  try {
    const refreshed = await refreshMarketDemandCache(env, now);
    return jsonResponse(refreshed.examples);
  } catch (error) {
    console.error("Failed to fetch market demand", error);

    if (cached) {
      return jsonResponse(cached.examples);
    }

    return jsonResponse([]);
  }
}

async function refreshMarketDemandCache(
  env: Env | undefined,
  now: number,
): Promise<CachedMarketDemand> {
  const cached = {
    fetchedAt: now,
    examples: await fetchMarketDemandExamples(now),
  };

  await writeMarketDemandCache(env, cached);

  return cached;
}

async function readMarketDemandCache(
  env: Env | undefined,
): Promise<CachedMarketDemand | undefined> {
  if (env?.MARKET_DEMAND_CACHE) {
    const raw = await env.MARKET_DEMAND_CACHE.get(MARKET_DEMAND_CACHE_KEY);

    if (!raw) {
      return undefined;
    }

    return parseCachedMarketDemand(raw);
  }

  return localCachedMarketDemand;
}

async function writeMarketDemandCache(
  env: Env | undefined,
  cached: CachedMarketDemand,
): Promise<void> {
  if (env?.MARKET_DEMAND_CACHE) {
    await env.MARKET_DEMAND_CACHE.put(
      MARKET_DEMAND_CACHE_KEY,
      JSON.stringify(cached),
      { expirationTtl: CACHE_RETENTION_SECONDS },
    );
    return;
  }

  localCachedMarketDemand = cached;
}

function parseCachedMarketDemand(raw: string): CachedMarketDemand | undefined {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const cached = value as Record<string, unknown>;

  if (
    typeof cached.fetchedAt !== "number" ||
    !Array.isArray(cached.examples) ||
    !cached.examples.every(isMarketDemandExample)
  ) {
    return undefined;
  }

  return {
    fetchedAt: cached.fetchedAt,
    examples: cached.examples,
  };
}

function isFreshCache(cached: CachedMarketDemand, now: number): boolean {
  return cached.fetchedAt + CACHE_TTL_MS > now;
}

function isMarketDemandExample(value: unknown): value is MarketDemandExample {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const example = value as Record<string, unknown>;

  return (
    (example.action === "buy" || example.action === "sell") &&
    (example.asset === "BTC" || example.asset === "ETH") &&
    typeof example.amount === "number" &&
    typeof example.strike === "number" &&
    typeof example.daysToExpiry === "number" &&
    typeof example.premium === "number" &&
    typeof example.instrumentName === "string"
  );
}

async function fetchMarketDemandExamples(
  now: number,
): Promise<MarketDemandExample[]> {
  const currencies = ["BTC", "ETH"] as const;
  const instrumentsByCurrency = await Promise.all(
    currencies.map(async (currency) => ({
      currency,
      instruments: await deriveRpc<DeriveInstrument[]>("public/get_instruments", {
        currency,
        expired: false,
        instrument_type: "option",
      }),
    })),
  );

  const examples: MarketDemandExample[] = [];
  const specs = [
    { action: "buy" as const, optionType: "P" as const, minDays: 21 },
    { action: "buy" as const, optionType: "P" as const, minDays: 5 },
    { action: "sell" as const, optionType: "C" as const, minDays: 21 },
    { action: "sell" as const, optionType: "C" as const, minDays: 5 },
  ];

  for (const spec of specs) {
    const candidates = instrumentsByCurrency
      .map(({ currency, instruments }) => ({
        currency,
        expiry: chooseExpiry(instruments, spec.minDays, now),
      }))
      .filter((candidate) => candidate.expiry !== undefined)
      .sort((left, right) => {
        const leftDays = daysUntil(left.expiry ?? 0, now);
        const rightDays = daysUntil(right.expiry ?? 0, now);
        return leftDays - rightDays;
      });

    for (const candidate of candidates) {
      if (candidate.expiry === undefined) {
        continue;
      }

      const example = await fetchExampleForExpiry({
        action: spec.action,
        currency: candidate.currency,
        expiryMs: candidate.expiry,
        minDays: spec.minDays,
        now,
        optionType: spec.optionType,
      });

      if (example) {
        examples.push(example);
        break;
      }
    }
  }

  if (examples.length !== specs.length) {
    throw new Error("Not enough Derive examples");
  }

  return examples;
}

async function fetchExampleForExpiry({
  action,
  currency,
  expiryMs,
  minDays,
  now,
  optionType,
}: {
  action: "buy" | "sell";
  currency: "BTC" | "ETH";
  expiryMs: number;
  minDays: number;
  now: number;
  optionType: "C" | "P";
}): Promise<MarketDemandExample | undefined> {
  const result = await deriveRpc<{ tickers: Record<string, DeriveTicker> }>(
    "public/get_tickers",
    {
      currency,
      expiry_date: expiryDate(expiryMs),
      instrument_type: "option",
    },
  );
  const options = Object.entries(result.tickers)
    .map(([instrumentName, ticker]) => {
      const details = parseInstrumentName(instrumentName);
      const bid = Number(ticker.b);
      const bidSize = Number(ticker.B);
      const index = Number(ticker.I);

      if (
        details === undefined ||
        details.optionType !== optionType ||
        !Number.isFinite(bid) ||
        !Number.isFinite(bidSize) ||
        !Number.isFinite(index) ||
        bid <= 0 ||
        bidSize <= 0
      ) {
        return undefined;
      }

      const isFriendlyPut =
        optionType === "P" && details.strike <= index * 0.98;
      const isFriendlyCall =
        optionType === "C" && details.strike >= index * 1.02;

      if (!isFriendlyPut && !isFriendlyCall) {
        return undefined;
      }

      return {
        amount: bidSize,
        bid,
        distanceFromSpot: Math.abs(details.strike / index - 1),
        instrumentName,
        strike: details.strike,
      };
    })
    .filter((option) => option !== undefined)
    .sort((left, right) => {
      const premiumDiff = right.bid * right.amount - left.bid * left.amount;

      if (Math.abs(premiumDiff) > 50) {
        return premiumDiff;
      }

      return left.distanceFromSpot - right.distanceFromSpot;
    });

  const selected = options[0];

  if (selected === undefined) {
    return undefined;
  }

  return example(
    action,
    currency,
    selected.amount,
    selected.strike,
    Math.max(minDays, daysUntil(expiryMs, now)),
    selected.bid * selected.amount,
    selected.instrumentName,
  );
}

function chooseExpiry(
  instruments: DeriveInstrument[],
  minDays: number,
  now: number,
): number | undefined {
  const expiries = [
    ...new Set(
      instruments
        .filter((instrument) => instrument.is_active)
        .map((instrument) => instrument.option_details?.expiry)
        .filter(
          (expiry): expiry is number =>
            expiry !== undefined && daysUntil(expiry, now) >= minDays,
        )
    ),
  ];

  return expiries.sort((left, right) => left - right)[0];
}

async function deriveRpc<T>(method: string, params: object): Promise<T> {
  const response = await fetch(`${DERIVE_API_URL}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`Derive ${method} returned ${response.status}`);
  }

  const payload: unknown = await response.json();

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("result" in payload)
  ) {
    throw new Error(`Derive ${method} returned invalid JSON`);
  }

  return payload.result as T;
}

function parseInstrumentName(
  instrumentName: string,
):
  | {
      strike: number;
      optionType: "C" | "P";
    }
  | undefined {
  const parts = instrumentName.split("-");
  const strike = Number(parts[2]);
  const optionType = parts[3];

  if (
    parts.length !== 4 ||
    !Number.isFinite(strike) ||
    (optionType !== "C" && optionType !== "P")
  ) {
    return undefined;
  }

  return { strike, optionType };
}

function example(
  action: "buy" | "sell",
  asset: "BTC" | "ETH",
  amount: number,
  strike: number,
  daysToExpiry: number,
  premium: number,
  instrumentName: string,
): MarketDemandExample {
  return {
    action,
    asset,
    amount,
    strike: Math.round(strike),
    daysToExpiry,
    premium: Math.round(premium),
    instrumentName,
  };
}

function daysUntil(expirySeconds: number, now: number): number {
  return Math.ceil((expirySeconds * 1000 - now) / ONE_DAY_MS);
}

function expiryDate(expirySeconds: number): string {
  const date = new Date(expirySeconds * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}${month}${day}`;
}

function jsonResponse(examples: MarketDemandExample[]): Response {
  return Response.json(
    { examples },
    {
      headers: {
        "cache-control": MARKET_DEMAND_CACHE_CONTROL,
      },
    },
  );
}
