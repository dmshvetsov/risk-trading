import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";

import { AppChrome } from "./components/app-shell";
import { HomePage } from "./pages/home-page";
import { MakerVaultCardView } from "./pages/maker-vaults-page";
import { SharedStatesPage } from "./pages/shared-states-page";
import { TakerShellPage } from "./pages/taker-shell-page";
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

    assert.match(html, /Earn cash upfront/i);
    assert.match(html, /Open the taker shell/i);
  });

  it("shows mobile-first navigation and wallet session messaging", () => {
    const html = renderToStaticMarkup(
      <AppChrome
        currentPath="/quote-builder"
        walletLabel="Wallet not connected"
        showWalletButton={false}
        usePlainLinks
      >
        <div>Route content</div>
      </AppChrome>,
    );

    assert.match(html, /Taker shell/);
    assert.match(html, /Shared states/);
    assert.doesNotMatch(html, /Maker shell|Maker dashboard/);
    assert.match(html, /Wallet not connected/);
    assert.match(html, /Route content/);
  });
});

describe("Taker copy", () => {
  it("keeps the home page free of option jargon", () => {
    const html = renderToStaticMarkup(<HomePage usePlainLink />);

    assert.doesNotMatch(html, /option|derivative/i);
    assert.match(html, /Earn cash upfront/i);
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
});

describe("Maker copy", () => {
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
