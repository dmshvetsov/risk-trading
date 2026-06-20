import type { PropsWithChildren } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  const authLabel =
    walletLabel === "Wallet not connected" ? "Login" : walletLabel;

  return (
    <div className="min-h-screen bg-background px-4 py-4 sm:px-6 sm:py-5">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl flex-col">
        <header className="bg-card px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-12 sm:flex-row sm:items-center">
              {usePlainLinks ? (
                <a
                  href="/"
                  className="flex items-center gap-3 text-lg font-semibold tracking-tight"
                >
                  <span
                    aria-hidden="true"
                    className="size-9 shrink-0 bg-primary"
                  />
                  <span>LOGO</span>
                </a>
              ) : (
                <Link
                  to="/"
                  className="flex items-center gap-3 text-lg font-semibold tracking-tight"
                >
                  <span
                    aria-hidden="true"
                    className="size-9 shrink-0 bg-primary"
                  />
                  <span>LOGO</span>
                </Link>
              )}
              <nav
                aria-label="Primary"
                className="flex flex-wrap items-center gap-x-8 gap-y-3"
              >
                {navigationItems.map((item) => {
                  const isActive =
                    item.href === "/"
                      ? currentPath === item.href
                      : currentPath.startsWith(item.href);

                  const linkClassName = cn(
                    "text-lg font-semibold underline-offset-4 transition-colors hover:text-primary hover:underline",
                    isActive ? "underline" : "text-foreground",
                  );

                  return usePlainLinks ? (
                    <a key={item.href} className={linkClassName} href={item.href}>
                      {item.label}
                    </a>
                  ) : (
                    <Link key={item.href} className={linkClassName} to={item.href}>
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <div className="flex justify-start lg:justify-end">
              {showWalletButton ? (
                <Button className="min-w-32" variant="default">
                  {authLabel}
                </Button>
              ) : null}
            </div>
          </div>
        </header>
        <main className="flex-1 py-3 sm:py-6">{children}</main>
        <footer className="flex flex-col gap-3 border-t border-transparent px-1 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="order-2 sm:order-1">©2026 Company Name</span>
          <a className="order-1 underline underline-offset-4 sm:order-2" href="/docs">
            Docs
          </a>
        </footer>
      </div>
    </div>
  );
}
