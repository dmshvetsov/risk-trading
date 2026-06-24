const PYTH_HERMES_URL = "https://hermes.pyth.network";
const BTC_USD_PYTH_FEED_ID =
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

type Fetcher = typeof fetch;

export type PythSpotPrice = {
  price: number;
  publishTime: number;
};

export async function fetchBtcUsdPythPrice(
  fetcher: Fetcher = fetch,
): Promise<PythSpotPrice> {
  const url = new URL("/v2/updates/price/latest", PYTH_HERMES_URL);
  url.searchParams.append("ids[]", BTC_USD_PYTH_FEED_ID);
  url.searchParams.set("parsed", "true");

  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error("Pyth price unavailable");
  }

  const payload: unknown = await response.json();
  const price = readParsedPrice(payload);
  if (!price) {
    throw new Error("Pyth price payload invalid");
  }

  return price;
}

function readParsedPrice(payload: unknown): PythSpotPrice | null {
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
  if (!Number.isFinite(scaledPrice)) {
    return null;
  }

  return {
    price: scaledPrice,
    publishTime: rawPublishTime,
  };
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
