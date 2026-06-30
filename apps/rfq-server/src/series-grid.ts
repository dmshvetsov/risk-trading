import { BTC_USD_FEED_ID } from "./validation";
import { deriveSeriesId, TESTNET_UNDERWRITE_CONFIGS } from "./underwrite";

const HERMES_URL = "https://hermes.pyth.network";
const STRIKE_SCALE = 1_000_000n;
const STRIKE_STEP = 1_000;
const MIN_UNDERWRITE_TIME_TO_EXPIRY_MS = 8 * 60 * 60 * 1_000;
const COVERED_CALL_OFFSETS = [2_000, 3_000, 4_000, 6_000, 10_000, 14_000];
const CASH_SECURED_PUT_OFFSETS = [-2_000, -3_000, -4_000, -7_000, -12_000, -17_000];

export type SpotPrice = {
  price: number;
  publishTime: number;
};

type Fetcher = typeof fetch;

export async function getSpot(symbol: "BTC", fetcher: Fetcher = fetch) {
  const url = new URL("/v2/updates/price/latest", HERMES_URL);
  url.searchParams.append("ids[]", BTC_USD_FEED_ID);
  url.searchParams.set("parsed", "true");

  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`${symbol} spot unavailable`);
  }

  const payload: unknown = await response.json();
  const spot = readPythSpot(payload);
  if (!spot) {
    throw new Error(`${symbol} spot payload invalid`);
  }

  return spot;
}

function readPythSpot(payload: unknown): SpotPrice | null {
  const root = recordOrNull(payload);
  const parsed = Array.isArray(root?.parsed) ? root.parsed : null;
  const first = recordOrNull(parsed?.[0]);
  const price = recordOrNull(first?.price);
  const rawPrice = price?.price;
  const rawExpo = price?.expo;
  const rawPublishTime = price?.publish_time;

  if (
    typeof rawPrice !== "string" ||
    typeof rawExpo !== "number" ||
    typeof rawPublishTime !== "number"
  ) {
    return null;
  }

  const scaledPrice = Number(rawPrice) * 10 ** rawExpo;
  if (!Number.isFinite(scaledPrice) || scaledPrice <= 0) {
    return null;
  }

  return { price: scaledPrice, publishTime: rawPublishTime };
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function lastFridayOfMonth(year: number, month: number) {
  const date = new Date(Date.UTC(year, month + 1, 0));
  const day = date.getUTCDay();
  const daysSinceFriday = (day + 2) % 7;
  return Date.UTC(year, month, date.getUTCDate() - daysSinceFriday, 8);
}

export function futureFridayExpiries(nowUnixMs = Date.now()) {
  const now = new Date(nowUnixMs);
  const earliestExpiry = nowUnixMs + MIN_UNDERWRITE_TIME_TO_EXPIRY_MS;
  const lastAllowed = lastFridayOfMonth(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
  );
  const expiries: number[] = [];
  const cursor = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    8,
  ));
  const daysUntilFriday = (5 - cursor.getUTCDay() + 7) % 7;
  cursor.setUTCDate(cursor.getUTCDate() + daysUntilFriday);

  while (cursor.getTime() <= lastAllowed) {
    const expiry = cursor.getTime();
    if (expiry > earliestExpiry) {
      expiries.push(expiry);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return expiries;
}

function toStrikeDecimals(strikeUsd: number) {
  return (BigInt(strikeUsd) * STRIKE_SCALE).toString();
}

function buildItems(input: {
  expiries: readonly number[];
  marketId: string;
  offsets: readonly number[];
  optionType: 1 | 2;
  packageId: string;
  strikeBase: number;
}) {
  return input.expiries.flatMap((expiryUnixMs) =>
    input.offsets.map((offset) => {
      const strikePriceDecimals = toStrikeDecimals(input.strikeBase + offset);
      return {
        expiryUnixMs,
        seriesId: deriveSeriesId(
          input.packageId,
          input.marketId,
          input.optionType,
          strikePriceDecimals,
          expiryUnixMs,
        ),
        strikePriceDecimals,
      };
    }),
  );
}

export function buildSeriesGrid(input: {
  nowUnixMs?: number;
  packageId: string;
  spot: SpotPrice;
}) {
  const callConfig = TESTNET_UNDERWRITE_CONFIGS.find(
    (config) => config.callPutMarker === 1,
  );
  const putConfig = TESTNET_UNDERWRITE_CONFIGS.find(
    (config) => config.callPutMarker === 2,
  );
  if (!callConfig || !putConfig) {
    throw new Error("series grid market config unavailable");
  }

  const expiries = futureFridayExpiries(input.nowUnixMs);
  const callBase = Math.ceil(input.spot.price / STRIKE_STEP) * STRIKE_STEP;
  const putBase = Math.floor(input.spot.price / STRIKE_STEP) * STRIKE_STEP;

  return {
    market: {
      baseDecimals: callConfig.baseDecimals,
      baseCoinType: callConfig.baseCoinType,
      marketId: callConfig.marketId,
      oracleBaseSymbol: "BTC",
      oracleFeedId: BTC_USD_FEED_ID,
      oracleQuoteSymbol: "USDC",
      quoteDecimals: callConfig.quoteDecimals,
      quoteCoinType: callConfig.quoteCoinType,
      strikeScale: Number(STRIKE_SCALE),
    },
    spot: {
      price: input.spot.price,
      publishTime: input.spot.publishTime,
      symbol: "BTC",
    },
    series: {
      put: buildItems({
        expiries,
        marketId: putConfig.marketId,
        offsets: CASH_SECURED_PUT_OFFSETS,
        optionType: 2,
        packageId: input.packageId,
        strikeBase: putBase,
      }),
      call: buildItems({
        expiries,
        marketId: callConfig.marketId,
        offsets: COVERED_CALL_OFFSETS,
        optionType: 1,
        packageId: input.packageId,
        strikeBase: callBase,
      }),
    },
  };
}
