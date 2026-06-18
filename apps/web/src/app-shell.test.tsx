import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";

import { AppChrome } from "./components/app-shell";
import { HomePage } from "./pages/home-page";
import { MakerShellPage } from "./pages/maker-shell-page";
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
  it("uses professional options language on the maker shell", () => {
    const html = renderToStaticMarkup(
      <MakerShellPage>
        <div>Nested child slot</div>
      </MakerShellPage>,
    );

    assert.match(html, /covered call/i);
    assert.match(html, /cash-secured put/i);
    assert.match(html, /ITM|OTM/);
    assert.match(html, /Nested child slot/i);
  });
});

describe("Shared states", () => {
  it("shows reusable loading and error patterns", () => {
    const html = renderToStaticMarkup(<SharedStatesPage />);

    assert.match(html, /Loading boundaries are wired/i);
    assert.match(html, /Shared recovery state/i);
  });
});
