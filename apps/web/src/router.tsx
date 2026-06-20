import React, { Suspense } from "react";
import {
  Link,
  Outlet,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { useCurrentAccount } from "@mysten/dapp-kit";

import { AppShell } from "./components/app-shell";
import { ErrorPanel } from "./components/error-panel";
import { LoadingPanel } from "./components/loading-panel";
import { getWalletLabel } from "./lib/wallet";
import HomePage from "./pages/home-page";
import TakerShellPage from "./pages/taker-shell-page";
import MakerShellPage from "./pages/maker-shell-page";
import QuoteBuilderPage from "./pages/quote-builder-page";
import MakerShellIndexPage from "./pages/maker-shell-index-page";
import MakerVaultsPage from "./pages/maker-vaults-page";
import MakerPositionsPage from "./pages/maker-positions-page";
import SharedStatesPage from "./pages/shared-states-page";

class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <ErrorPanel
          title="This screen is unavailable"
          message="Refresh the page or return home while we reconnect."
        />
      );
    }

    return this.props.children;
  }
}

function RootLayout() {
  const account = useCurrentAccount();

  return (
    <AppShell walletLabel={getWalletLabel(account?.address ?? null)}>
      <RouteErrorBoundary>
        <Suspense fallback={<LoadingPanel message="Loading the next screen..." />}>
          <Outlet />
        </Suspense>
      </RouteErrorBoundary>
    </AppShell>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const takerShellRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/taker",
  component: () => (
    <TakerShellPage>
      <Outlet />
    </TakerShellPage>
  ),
});

const makerShellRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/maker",
  component: () => (
    <MakerShellPage>
      <Outlet />
    </MakerShellPage>
  ),
});

const sharedStatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/states",
  component: SharedStatesPage,
});

const takerShellIndexRoute = createRoute({
  getParentRoute: () => takerShellRoute,
  path: "/",
  component: QuoteBuilderPage,
});

const makerShellIndexRoute = createRoute({
  getParentRoute: () => makerShellRoute,
  path: "/",
  component: MakerShellIndexPage,
});

const makerVaultsRoute = createRoute({
  getParentRoute: () => makerShellRoute,
  path: "/vaults",
  component: MakerVaultsPage,
});

const makerPositionsRoute = createRoute({
  getParentRoute: () => makerShellRoute,
  path: "/positions",
  component: MakerPositionsPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  takerShellRoute.addChildren([takerShellIndexRoute]),
  makerShellRoute.addChildren([
    makerShellIndexRoute,
    makerVaultsRoute,
    makerPositionsRoute,
  ]),
  sharedStatesRoute,
]);

export function getRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history: history ?? createBrowserHistory(),
    defaultPendingComponent: () => (
      <LoadingPanel message="Loading the next screen..." />
    ),
    defaultErrorComponent: () => (
      <ErrorPanel
        title="Something went wrong"
        message="Try again in a moment."
      />
    ),
    defaultNotFoundComponent: () => (
      <ErrorPanel
        title="Page not found"
        message="Use the menu to return to a supported screen."
        actions={<Link to="/">Go home</Link>}
      />
    ),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
