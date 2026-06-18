import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MetricCard, PageSection, StatusStrip } from "../components/page-section";
import { appConfig } from "../lib/config";

export function HomePage({ usePlainLink = false }: { usePlainLink?: boolean }) {
  return (
    <div className="grid gap-6">
      <PageSection
        eyebrow="Home"
        title="Earn cash upfront with BTC-backed plans"
        description="Pick a target price and date, lock collateral, and receive a quote before you sign anything."
      >
        <Card className="overflow-hidden bg-primary text-primary-foreground">
          <CardHeader className="gap-3">
            <CardTitle className="text-2xl sm:text-3xl">Built for quick mobile decisions</CardTitle>
            <CardDescription className="max-w-2xl text-primary-foreground/80">
              The shell starts with one supported market and leaves real flows
              for later slices.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            {usePlainLink ? (
              <Button asChild variant="secondary">
                <a href="/taker">Open the taker shell</a>
              </Button>
            ) : (
              <Button asChild variant="secondary">
                <Link to="/taker">Open the taker shell</Link>
              </Button>
            )}
            <span className="text-sm text-primary-foreground/70">
              Simple language first. Real transaction detail later.
            </span>
          </CardContent>
        </Card>
        <StatusStrip>
          {appConfig.supportedAssets.map((asset) => (
            <MetricCard
              key={asset.symbol}
              label={asset.symbol}
              value={asset.step}
              hint={asset.payoutHint}
            />
          ))}
        </StatusStrip>
      </PageSection>
    </div>
  );
}

export default HomePage;
