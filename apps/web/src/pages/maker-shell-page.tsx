import type { PropsWithChildren } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

import {
  ListCard,
  MetricCard,
  PageSection,
  StatusStrip,
} from "../components/page-section";
import { cn } from "../lib/utils";

export function MakerShellPage({ children }: PropsWithChildren) {
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <div className="grid gap-6">
      <PageSection
        eyebrow="Maker Dashboard"
        title="Direct-access controls for professional maker workflows"
        description="This hidden route stays out of the main navigation while keeping vault controls and maker position state under one dashboard."
      >
        <StatusStrip>
          <MetricCard
            label="Access"
            value="Hidden"
            hint="There is no visible navigation link anywhere in the app shell."
          />
          <MetricCard
            label="Vaults"
            value="Active"
            hint="Manage quote and order endpoints, balances, and close flows."
          />
          <MetricCard
            label="Positions"
            value="ITM / OTM"
            hint="Settlement readiness and history stay on the same hidden route."
          />
        </StatusStrip>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            {
              href: "/maker/vaults",
              label: "Vaults",
              summary: "Balances, RFQ URLs, eligibility, and close action",
            },
            {
              href: "/maker/positions",
              label: "Positions",
              summary: "Open exposure, moneyness, settlement readiness, and history",
            },
          ].map((item) => {
            const isActive = currentPath === item.href;

            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "grid gap-1 border px-4 py-3 text-sm transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span className="font-medium">{item.label}</span>
                <small
                  className={cn(
                    "text-xs",
                    isActive ? "text-primary-foreground/80" : "text-muted-foreground",
                  )}
                >
                  {item.summary}
                </small>
              </Link>
            );
          })}
        </div>
        <ListCard
          title="Dashboard contract"
          items={[
            { label: "Hidden route", value: "Direct visit only for market makers" },
            { label: "Vault source", value: "RFQ database plus on-chain balance reads" },
            { label: "Maker language", value: "Covered call, cash-secured put, ITM, OTM" },
          ]}
        />
        {children}
      </PageSection>
    </div>
  );
}

export default MakerShellPage;
