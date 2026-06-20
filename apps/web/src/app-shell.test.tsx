import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";

import { AppChrome } from "./components/app-shell";
import { HomePage } from "./pages/home-page";
import { MakerVaultCardView, MakerVaultsView } from "./pages/maker-vaults-page";
import { SharedStatesPage } from "./pages/shared-states-page";
import { TakerShellPage } from "./pages/taker-shell-page";
import {
  QuoteBuilderView,
  requestCoveredCallQuote,
  secondsUntilExpiry,
} from "./pages/quote-builder-page";
import { SuiProviders } from "./components/sui-providers";
import { getRouter } from "./router";

describe("App shell", () => {
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
    assert.match(html, /EARN 63\.19 USDC NOW/i);
  });

  it("shows global marketing navigation and auth button copy", () => {
    const html = renderToStaticMarkup(
      <AppChrome
        currentPath="/taker"
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

  it("keeps the taker shell simple and setup-focused", () => {
    const html = renderToStaticMarkup(
      <TakerShellPage>
        <div>Nested child slot</div>
      </TakerShellPage>,
    );

    assert.doesNotMatch(html, /option|derivative/i);
    assert.match(html, /Wallet-gated seller routes mount here/i);
    assert.match(html, /Nested child slot/i);
  });

  it("shows a covered-call quote with collateral, timer, and both outcomes", () => {
    const html = renderToStaticMarkup(
      <QuoteBuilderView
        isLoading={false}
        quote={{
          cashPremiumPerContract: "1263800000",
          cashTokenDecimals: 6,
          contractsQtyDecimals: "5000000",
          collateralTokenDecimals: 8,
          expiryUnixMs: Date.now() + 30_000,
          offerValidUntilUnixMs: Date.now() + 30_000,
          strikePriceDecimals: "68000000000",
        }}
        onSubmit={() => undefined}
      />,
    );

    assert.match(html, /0\.05 WBTC/);
    assert.match(html, /63\.19 USDC/);
    assert.match(html, /Quote expires in/i);
    assert.match(html, /BTC stays at or below/i);
    assert.match(html, /BTC finishes above/i);
  });

  it("reduces the quote countdown as time passes", () => {
    assert.equal(secondsUntilExpiry(31_000, 1_000), 30);
    assert.equal(secondsUntilExpiry(31_000, 11_000), 20);
    assert.equal(secondsUntilExpiry(31_000, 41_000), 0);
  });

  it("sends the supported market request to RFQ and maps its quote", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const quote = await requestCoveredCallQuote(
      "https://rfq.example",
      "0x0::usdc::USDC",
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

  it("renders the maker positions sub-page on direct visit", async () => {
    const testRouter = getRouter(
      createMemoryHistory({
        initialEntries: ["/maker/positions"],
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

    assert.match(html, /Positions/);
    assert.match(html, /Settlement readiness/i);
  });
});

describe("Shared states", () => {
  it("shows reusable loading and error patterns", () => {
    const html = renderToStaticMarkup(<SharedStatesPage />);

    assert.match(html, /Loading boundaries are wired/i);
    assert.match(html, /Shared recovery state/i);
  });
});
