import type { PropsWithChildren } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ConnectButton, useDisconnectWallet } from "@mysten/dapp-kit";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import favenLogo from "@/assets/faven-logo.svg";
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
    <div className="min-h-screen bg-background px-4 py-4 sm:px-6 sm:py-5">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl flex-col">
        <header className="bg-card px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-10">
              {usePlainLinks ? (
                <a
                  href="/"
                  className="flex h-10 items-center"
                >
                  <img
                    alt="Faven"
                    className="h-8 w-auto shrink-0 sm:h-9"
                    src={favenLogo}
                  />
                </a>
              ) : (
                <Link
                  to="/"
                  className="flex h-10 items-center"
                >
                  <img
                    alt="Faven"
                    className="h-8 w-auto shrink-0 sm:h-9"
                    src={favenLogo}
                  />
                </Link>
              )}
              <nav
                aria-label="Primary"
                className="flex flex-wrap items-center gap-x-8 gap-y-2"
              >
                {navigationItems.map((item) => {
                  const isActive =
                    item.href === "/"
                      ? currentPath === item.href
                      : currentPath.startsWith(item.href);

                  const linkClassName = cn(
                    "inline-flex h-10 items-center text-lg font-semibold underline-offset-4 transition-colors hover:text-primary hover:underline",
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
            <div className="flex items-center justify-start lg:justify-end">
              {showWalletButton ? <WalletAction walletLabel={walletLabel} /> : null}
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

function WalletAction({ walletLabel }: Pick<AppChromeProps, "walletLabel">) {
  const isConnected = walletLabel !== "Wallet not connected";
  const { mutate: disconnectWallet, isPending: isDisconnecting } =
    useDisconnectWallet();

  if (!isConnected) {
    return <ConnectButton className="min-w-32" connectText="Login" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="min-w-32" variant="default">
          {walletLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem
          disabled={isDisconnecting}
          onSelect={() => {
            disconnectWallet();
          }}
        >
          {isDisconnecting ? "Disconnecting..." : "Disconnect"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
