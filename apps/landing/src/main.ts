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

  const data: MarketDemandResponse | MarketDemandExample[] = await response.json();
  const examples = (Array.isArray(data) ? data : data.examples ?? []).filter(
    isMarketDemandExample,
  );

  if (examples.length === 0) {
    container.innerText = "";
    return;
  }

  let exampleIndex = 0;
  renderMarketDemand(container, examples[exampleIndex], false);

  window.setInterval(() => {
    exampleIndex = (exampleIndex + 1) % examples.length;
    renderMarketDemand(container, examples[exampleIndex], true);
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
    amount: formatPlainNumber(example.amount),
    asset: `$${example.asset}`,
    strike: formatMoney(example.strike),
    daysToExpiry: formatPlainNumber(example.daysToExpiry),
    premium: formatMoney(example.premium),
  };

  for (const token of MARKET_DEMAND_TOKENS) {
    const element = container.querySelector(`[data-market-token="${token}"]`);

    if (!(element instanceof HTMLElement) || element.innerText === values[token]) {
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

function formatPlainNumber(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 6,
  });
}

function capitalize(value: "buy" | "sell"): "Buy" | "Sell" {
  return value === "buy" ? "Buy" : "Sell";
}

function submitHandler(event: SubmitEvent) {
  event.preventDefault();

  const form = event.currentTarget;

  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const container = form.closest(".newsletter-form-container");

  if (!(container instanceof HTMLElement)) {
    return;
  }

  const formInput = container.querySelector(".newsletter-form-input");
  const success = container.querySelector(".newsletter-success");
  const errorContainer = container.querySelector(".newsletter-error");
  const errorMessage = container.querySelector(".newsletter-error-message");
  const backButton = container.querySelector(".newsletter-back-button");
  const submitButton = container.querySelector(".newsletter-form-button");
  const loadingButton = container.querySelector(".newsletter-loading-button");

  if (
    !(formInput instanceof HTMLInputElement) ||
    !(success instanceof HTMLElement) ||
    !(errorContainer instanceof HTMLElement) ||
    !(errorMessage instanceof HTMLElement) ||
    !(backButton instanceof HTMLButtonElement) ||
    !(submitButton instanceof HTMLButtonElement) ||
    !(loadingButton instanceof HTMLButtonElement)
  ) {
    return;
  }

  const rateLimit = () => {
    errorContainer.style.display = "flex";
    errorMessage.innerText = "Too many signups, please try again in a little while";
    submitButton.style.display = "none";
    formInput.style.display = "none";
    backButton.style.display = "block";
  };

  const timestamp = Date.now();
  const previousTimestamp = localStorage.getItem("loops-form-timestamp");

  if (previousTimestamp && Number(previousTimestamp) + 60_000 > timestamp) {
    rateLimit();
    return;
  }

  localStorage.setItem("loops-form-timestamp", String(timestamp));

  submitButton.style.display = "none";
  loadingButton.style.display = "flex";

  const formBody = `userGroup=&mailingLists=&email=${encodeURIComponent(
    formInput.value,
  )}`;

  fetch(form.action, {
    method: "POST",
    body: formBody,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  })
    .then(async (response) => {
      if (response.ok) {
        success.style.display = "flex";
        form.reset();
        return;
      }

      const rawData: unknown = await response.json().catch(() => null);
      const data =
        rawData !== null &&
        typeof rawData === "object" &&
        "message" in rawData &&
        (typeof rawData.message === "string" || rawData.message === undefined)
          ? { message: rawData.message }
          : null;

      errorContainer.style.display = "flex";
      errorMessage.innerText = data?.message ?? response.statusText;
      localStorage.setItem("loops-form-timestamp", "");
    })
    .catch((error: unknown) => {
      if (error instanceof Error && error.message === "Failed to fetch") {
        rateLimit();
        return;
      }

      errorContainer.style.display = "flex";
      errorMessage.innerText =
        error instanceof Error
          ? error.message
          : "Oops! Something went wrong, please try again";
      localStorage.setItem("loops-form-timestamp", "");
    })
    .finally(() => {
      formInput.style.display = "none";
      loadingButton.style.display = "none";
      backButton.style.display = "block";
    });
}

function resetFormHandler(event: MouseEvent) {
  const button = event.currentTarget;

  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const container = button.closest(".newsletter-form-container");

  if (!(container instanceof HTMLElement)) {
    return;
  }

  const formInput = container.querySelector(".newsletter-form-input");
  const success = container.querySelector(".newsletter-success");
  const errorContainer = container.querySelector(".newsletter-error");
  const errorMessage = container.querySelector(".newsletter-error-message");
  const backButton = container.querySelector(".newsletter-back-button");
  const submitButton = container.querySelector(".newsletter-form-button");

  if (
    !(formInput instanceof HTMLInputElement) ||
    !(success instanceof HTMLElement) ||
    !(errorContainer instanceof HTMLElement) ||
    !(errorMessage instanceof HTMLElement) ||
    !(backButton instanceof HTMLButtonElement) ||
    !(submitButton instanceof HTMLButtonElement)
  ) {
    return;
  }

  success.style.display = "none";
  errorContainer.style.display = "none";
  errorMessage.innerText = "Oops! Something went wrong, please try again";
  backButton.style.display = "none";
  formInput.style.display = "flex";
  submitButton.style.display = "flex";
}

for (const container of document.querySelectorAll(".newsletter-form-container")) {
  if (!(container instanceof HTMLElement)) {
    continue;
  }

  if (container.classList.contains("newsletter-handlers-added")) {
    continue;
  }

  const form = container.querySelector(".newsletter-form");
  const backButton = container.querySelector(".newsletter-back-button");

  if (form instanceof HTMLFormElement) {
    form.addEventListener("submit", submitHandler);
  }

  if (backButton instanceof HTMLButtonElement) {
    backButton.addEventListener("click", resetFormHandler);
  }

  container.classList.add("newsletter-handlers-added");
}

updateMarketDemand().catch((error: unknown) => {
  console.error("Failed to update market demand", error);
});
