import "./styles.css";

type MarketDemandResponse = {
  examples?: MarketDemandExample[];
};

type MarketDemandExample = {
  action: "buy" | "sell";
  asset: string;
  amount: number;
  strike: number;
  daysToExpiry: number;
  premium: number;
};

const MARKET_DEMAND_INTERVAL_MS = 6000;
const MARKET_DEMAND_TOKENS = [
  "action",
  "amount",
  "asset",
  "strike",
  "daysToExpiry",
  "premium",
] as const;
const EXAMPLES_SCALES: Record<string, [number, number, number, number]> = {
  BTC: [1, 0.5, 0.2, 0.1],
  ETH: [1, 2, 0.5, 1],
  SUI: [1000, 500, 500, 2000]
};

type MarketDemandToken = (typeof MARKET_DEMAND_TOKENS)[number];

async function updateMarketDemand() {
  const container = document.querySelector("#market-demand");

  if (!(container instanceof HTMLElement)) {
    return;
  }

  container.innerText = "";

  const response = await fetch("/api/market-demand");

  if (!response.ok) {
    return;
  }

  if (!response.headers.get("content-type")?.includes("application/json")) {
    return;
  }

  const data: MarketDemandResponse | MarketDemandExample[] =
    await response.json();
  const examples = (Array.isArray(data) ? data : (data.examples ?? [])).filter(
    isMarketDemandExample,
  );

  if (examples.length === 0) {
    container.innerText = "";
    return;
  }

  let exampleIndex = 0;
  renderMarketDemand(container, scaledExample(examples[exampleIndex], EXAMPLES_SCALES.BTC[0]), false);

  window.setInterval(() => {
    exampleIndex = (exampleIndex + 1) % examples.length;
    renderMarketDemand(
      container,
      scaledExample(
        examples[exampleIndex],
        EXAMPLES_SCALES.BTC[exampleIndex % EXAMPLES_SCALES.BTC.length],
      ),
      true,
    );
  }, MARKET_DEMAND_INTERVAL_MS);
}

function isMarketDemandExample(value: unknown): value is MarketDemandExample {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const example = value as Record<string, unknown>;

  return (
    (example.action === "buy" || example.action === "sell") &&
    typeof example.asset === "string" &&
    typeof example.amount === "number" &&
    typeof example.strike === "number" &&
    typeof example.daysToExpiry === "number" &&
    typeof example.premium === "number"
  );
}

function renderMarketDemand(
  container: HTMLElement,
  example: MarketDemandExample,
  animate: boolean,
) {
  if (container.childElementCount === 0) {
    container.replaceChildren(createMarketDemandNode());
  }

  const values: Record<MarketDemandToken, string> = {
    action: capitalize(example.action),
    amount: formatDecimalNumber(example.amount),
    asset: `$${example.asset}`,
    strike: formatMoney(example.strike),
    daysToExpiry: formatWholeNumber(example.daysToExpiry),
    premium: formatMoney(example.premium),
  };

  for (const token of MARKET_DEMAND_TOKENS) {
    const element = container.querySelector(`[data-market-token="${token}"]`);

    if (
      !(element instanceof HTMLElement) ||
      element.innerText === values[token]
    ) {
      continue;
    }

    element.innerText = values[token];

    if (animate) {
      element.classList.remove("is-changing");
      void element.offsetWidth;
      element.classList.add("is-changing");
    }
  }
}

function createMarketDemandNode(): DocumentFragment {
  const template = document.createElement("template");

  template.innerHTML = `
    <span class="market-demand-main">
      <span class="market-demand-token market-demand-action" data-market-token="action"></span>
      <span class="market-demand-token market-demand-amount" data-market-token="amount"></span>
      <span class="market-demand-token market-demand-asset" data-market-token="asset"></span>
      <span>at</span>
      <span class="market-demand-token market-demand-price" data-market-token="strike"></span>
      <span>in</span>
      <span class="market-demand-token market-demand-days" data-market-token="daysToExpiry"></span>
      <span>days</span>
      <span class="market-demand-comma">,</span>
    </span>
    <span class="market-demand-payout">
      <span>get</span>
      <span class="market-demand-token market-demand-premium" data-market-token="premium"></span>
      <span>now</span>
    </span>
  `;

  return template.content;
}

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatWholeNumber(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

function formatDecimalNumber(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
}

function capitalize(value: "buy" | "sell"): "Buy" | "Sell" {
  return value === "buy" ? "Buy" : "Sell";
}


updateMarketDemand().catch((error: unknown) => {
  console.error("Failed to update market demand", error);
});

function scaledExample(
  origin: MarketDemandExample,
  amountScaleTo: number,
): MarketDemandExample {
  return {
    ...origin,
    amount: amountScaleTo,
    premium: (origin.premium * amountScaleTo) / origin.amount,
  };
}
