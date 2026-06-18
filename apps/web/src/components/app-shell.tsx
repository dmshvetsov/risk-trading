import type { PropsWithChildren } from "react";
import { ConnectButton } from "@mysten/dapp-kit";
import { Link, useRouterState } from "@tanstack/react-router";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.06),_transparent_28%),linear-gradient(180deg,_var(--background),_color-mix(in_oklch,var(--background),black_8%))] px-4 py-4 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-4">
        <header className="border border-border bg-card/95 px-6 py-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Risk Trading
              </p>
              <div className="grid gap-2">
                <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
                  Instant cash, clear obligations
                </h1>
                <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                  Buyer and seller routes share one clean shell, one design system, and room for later RFQ flows.
                </p>
              </div>
            </div>
            <div className="grid gap-3">
              <span className="inline-flex w-fit border border-border bg-muted px-3 py-1.5 text-sm text-muted-foreground">
                {walletLabel}
              </span>
              {showWalletButton ? <ConnectButton /> : null}
            </div>
          </div>
        </header>
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Card className="bg-card/95 backdrop-blur">
            <CardContent className="grid gap-1 p-2">
              <nav aria-label="Primary" className="grid gap-1">
                {navigationItems.map((item) => {
                  const isActive = currentPath === item.href;
                  const itemClassName = cn(
                    "grid gap-1 border px-4 py-3 text-sm transition-colors",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground",
                  );
                  const summaryClassName = cn(
                    "text-xs",
                    isActive ? "text-primary-foreground/80" : "text-muted-foreground",
                  );

                  return usePlainLinks ? (
                    <a key={item.href} className={itemClassName} href={item.href}>
                      <span className="font-medium">{item.label}</span>
                      <small className={summaryClassName}>{item.summary}</small>
                    </a>
                  ) : (
                    <Link key={item.href} className={itemClassName} to={item.href}>
                      <span className="font-medium">{item.label}</span>
                      <small className={summaryClassName}>{item.summary}</small>
                    </Link>
                  );
                })}
              </nav>
            </CardContent>
          </Card>
          <Card className="bg-card/95 backdrop-blur">
            <CardContent className="p-6">{children}</CardContent>
          </Card>
        </div>
        <footer className="grid gap-1 border border-border bg-card/95 px-6 py-4 text-xs text-muted-foreground sm:grid-cols-3">
          <span>Network: {appConfig.network}</span>
          <span>RFQ API: {appConfig.rfqApiUrl}</span>
          <span>Broadcast API: {appConfig.broadcastApiUrl}</span>
        </footer>
      </div>
    </div>
  );
}
