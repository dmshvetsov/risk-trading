import type { PropsWithChildren } from "react";
import { ConnectButton } from "@mysten/dapp-kit";
import { Link, useRouterState } from "@tanstack/react-router";

import { appConfig } from "../lib/config";
import { navigationItems } from "../lib/navigation";

type AppShellProps = PropsWithChildren<{
  walletLabel: string;
}>;

type AppChromeProps = PropsWithChildren<{
  currentPath: string;
  walletLabel: string;
  showWalletButton?: boolean;
  usePlainLinks?: boolean;
}>;

export function AppShell({ children, walletLabel }: AppShellProps) {
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <AppChrome currentPath={currentPath} walletLabel={walletLabel}>
      {children}
    </AppChrome>
  );
}

export function AppChrome({
  children,
  currentPath,
  walletLabel,
  showWalletButton = true,
  usePlainLinks = false,
}: AppChromeProps) {
  return (
    <div className="app-frame">
      <div className="app-glow app-glow-left" />
      <div className="app-glow app-glow-right" />
      <header className="topbar">
        <div>
          <p className="eyebrow">Risk Trading</p>
          <h1>Instant cash, clear obligations</h1>
        </div>
        <div className="wallet-area">
          <span className="wallet-chip">{walletLabel}</span>
          {showWalletButton ? <ConnectButton /> : null}
        </div>
      </header>
      <div className="shell-grid">
        <nav className="nav-card" aria-label="Primary">
          {navigationItems.map((item) => {
            const isActive = currentPath === item.href;

            return (
              usePlainLinks ? (
                <a
                  key={item.href}
                  className={isActive ? "nav-link nav-link-active" : "nav-link"}
                  href={item.href}
                >
                  <span>{item.label}</span>
                  <small>{item.summary}</small>
                </a>
              ) : (
                <Link
                  key={item.href}
                  className={isActive ? "nav-link nav-link-active" : "nav-link"}
                  to={item.href}
                >
                  <span>{item.label}</span>
                  <small>{item.summary}</small>
                </Link>
              )
            );
          })}
        </nav>
        <main className="content-card">{children}</main>
      </div>
      <footer className="footer-copy">
        <span>Network: {appConfig.network}</span>
        <span>RFQ API: {appConfig.rfqApiUrl}</span>
        <span>Broadcast API: {appConfig.broadcastApiUrl}</span>
      </footer>
    </div>
  );
}
