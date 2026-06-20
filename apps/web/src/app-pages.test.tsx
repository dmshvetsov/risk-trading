import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";

import { AppChrome } from "./components/app-shell";
import { HomePage } from "./pages/home-page";
import { MakerVaultCardView, MakerVaultsView } from "./pages/maker-vaults-page";
import { SharedStatesPage } from "./pages/shared-states-page";
import {
  quantityToContractsQtyDecimals,
  quoteTerms,
  requestQuote,
  secondsUntilExpiry,
} from "./lib/quote-request";
import { SuiProviders } from "./components/sui-providers";
import { getRouter } from "./router";

describe("App pages", () => {
  it("renders the home route at slash", async () => {
    const testRouter = getRouter(
      createMemoryHistory({
        initialEntries: ["/"],
      }),
    );
    const queryClient = new QueryClient();

    await testRouter.load();

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SuiProviders>
          <RouterProvider router={testRouter} />
        </SuiProviders>
      </QueryClientProvider>,
    );

    assert.match(html, /Earn Upfront Yield/i);
    assert.match(html, /deposit 0\.05 WBTC as collateral/i);
    assert.match(html, /QUOTE UNAVAILABLE/i);
  });

  it("shows global marketing navigation and auth button copy", () => {
    const html = renderToStaticMarkup(
      <AppChrome
        currentPath="/maker"
        walletLabel="Wallet not connected"
        showWalletButton={false}
        usePlainLinks
      >
        <div>Route content</div>
      </AppChrome>,
    );

    assert.match(html, /Earn/);
    assert.match(html, /Dashboard/);
    assert.doesNotMatch(html, /Maker shell|Maker dashboard|Shared states/);
    assert.match(html, /Docs/);
    assert.match(html, /Route content/);
  });
});

describe("Taker copy", () => {
  it("keeps the home page free of option jargon", () => {
    const html = renderToStaticMarkup(<HomePage usePlainLink />);

    assert.doesNotMatch(html, /option|derivative/i);
    assert.match(html, /deposit 0\.05 WBTC as collateral/i);
  });

  it("reduces the quote countdown as time passes", () => {
    assert.equal(secondsUntilExpiry(31_000, 1_000), 30);
    assert.equal(secondsUntilExpiry(31_000, 11_000), 20);
    assert.equal(secondsUntilExpiry(31_000, 41_000), 0);
  });

  it("sends the supported market request to RFQ and maps its quote", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const quote = await requestQuote(
      "https://rfq.example",
      "0x0::usdc::USDC",
      "covered-call",
      { expiryUnixMs: 1_800_000_000_000, size: 0.05, strike: 68_000 },
      async (input, init) => {
        requests.push({ input, init });
        return Response.json({ quote: {
          cash_premium_per_contract: "1263800000", cash_token_decimals: 6,
          collateral_token_decimals: 8, expiry_unix_ms: 1_800_000_000_000,
          offer_valid_until_total_contracts_qty_decimals: "5000000",
          offer_valid_until_unix_ms: 1_799_000_000_000,
          strike_price_decimals: "68000000000",
        }});
      },
    );

    assert.equal(requests[0]?.input, "https://rfq.example/api/quotes");
    const body = JSON.parse(String(requests[0]?.init?.body));
    assert.equal(body.request.cash_token_address, "0x0::usdc::USDC");
    assert.equal(body.request.collateral_token_address.includes("::wbtc::WBTC"), true);
    assert.equal(body.request.contracts_qty_decimals, "5000000");
    assert.equal(quote.cashPremiumPerContract, "1263800000");
  });

  it("uses the shared request path with cash collateral for puts", async () => {
    let body: { request: Record<string, unknown> } | undefined;
    await requestQuote(
      "https://rfq.example",
      "0x0::usdc::USDC",
      "cash-secured-put",
      { expiryUnixMs: 1_800_000_000_000, size: 0.05, strike: 68_000 },
      async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ quote: {
          cash_premium_per_contract: "1000000000", cash_token_decimals: 6,
          collateral_token_decimals: 6, expiry_unix_ms: 1_800_000_000_000,
          offer_valid_until_total_contracts_qty_decimals: "3400000000",
          offer_valid_until_unix_ms: 1_799_000_000_000,
          strike_price_decimals: "68000000000",
        }});
      },
    );

    assert.equal(body?.request.call_put_marker, 2);
    assert.equal(body?.request.collateral_token_address, "0x0::usdc::USDC");
    assert.equal(body?.request.collateral_token_decimals, 6);
    assert.equal(body?.request.contracts_qty_decimals, "5000000");
  });

  it("encodes contracts quantity in base coin decimals", () => {
    assert.equal(quantityToContractsQtyDecimals(0.005), "500000");
    assert.equal(quantityToContractsQtyDecimals(0.05), "5000000");
    assert.equal(quantityToContractsQtyDecimals(1), "100000000");
  });

  it("calculates put cash collateral and above/below-strike outcomes", () => {
    assert.deepEqual(quoteTerms("cash-secured-put", 0.05, 68_000), {
      collateralAmount: 3_400,
      collateralSymbol: "USDC",
      downsideAmount: 0.05,
      downsideSymbol: "WBTC",
      upsideAmount: 3_400,
      upsideSymbol: "USDC",
    });
  });

  it("renders not found for the removed taker route", async () => {
    const testRouter = getRouter(
      createMemoryHistory({
        initialEntries: ["/taker"],
      }),
    );
    const queryClient = new QueryClient();

    await testRouter.load();

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SuiProviders>
          <RouterProvider router={testRouter} />
        </SuiProviders>
      </QueryClientProvider>,
    );

    assert.match(html, /Page not found/);
  });
});

describe("Maker copy", () => {
  it("renders the connected maker create-vault form", () => {
    const html = renderToStaticMarkup(
      <MakerVaultsView
        accountAddress="0xmaker"
        isLoading={false}
        supportedCoins={[
          {
            coinType:
              "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
            network: "testnet",
            symbol: "USDC",
          },
        ]}
        vaults={[]}
      />,
    );

    assert.match(html, /Create vault/);
    assert.match(html, /Quote endpoint URL/);
    assert.match(html, /Order endpoint URL/);
    assert.match(html, /USDC/);
  });

  it("renders vault state, edit controls, and close action on the vaults tab", () => {
    const html = renderToStaticMarkup(
      <MakerVaultCardView
        vault={{
          balance: "250.00 USDC",
          enabled: true,
          orderEndpointUrl: "https://maker.example/orders",
          quoteCoinSymbol: "USDC",
          quoteCoinType:
            "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
          quoteEndpointUrl: "https://maker.example/quotes",
          vaultId: "0xvault-1",
        }}
        quoteEndpointUrl="https://maker.example/quotes"
        orderEndpointUrl="https://maker.example/orders"
        closeVaultDigest=""
        onQuoteEndpointUrlChange={() => undefined}
        onOrderEndpointUrlChange={() => undefined}
        onCloseVaultDigestChange={() => undefined}
        onUpdateEndpoints={() => undefined}
        onSubmitCloseDigest={() => undefined}
      />,
    );

    assert.match(html, /250.00 USDC/);
    assert.match(html, /Save vault endpoints/);
    assert.match(html, /Submit close digest/);
    assert.match(html, /Ready for RFQs/);
  });

  it("renders the hidden maker route on direct visit", async () => {
    const testRouter = getRouter(
      createMemoryHistory({
        initialEntries: ["/maker"],
      }),
    );
    const queryClient = new QueryClient();

    await testRouter.load();

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SuiProviders>
          <RouterProvider router={testRouter} />
        </SuiProviders>
      </QueryClientProvider>,
    );

    assert.match(html, /Maker Dashboard/);
    assert.match(html, /\/maker\/vaults/);
    assert.match(html, /\/maker\/positions/);
  });
});

describe("Shared states", () => {
  it("shows reusable loading and error patterns", () => {
    const html = renderToStaticMarkup(<SharedStatesPage />);

    assert.match(html, /Loading boundaries are wired/i);
    assert.match(html, /Shared recovery state/i);
  });
});
