import { Link } from "@tanstack/react-router";

import { MetricCard, PageSection, StatusStrip } from "../components/page-section";
import { appConfig } from "../lib/config";

export function HomePage({ usePlainLink = false }: { usePlainLink?: boolean }) {
  return (
    <div className="page-stack">
      <PageSection
        eyebrow="Home"
        title="Earn cash upfront with BTC-backed plans"
        description="Pick a target price and date, lock collateral, and receive a quote before you sign anything."
      >
        <div className="hero-card">
          <div>
            <h3>Built for quick mobile decisions</h3>
            <p>
              The shell starts with one supported market and leaves real flows
              for later slices.
            </p>
          </div>
          {usePlainLink ? (
            <a className="primary-action" href="/taker">
              Open the taker shell
            </a>
          ) : (
            <Link className="primary-action" to="/taker">
              Open the taker shell
            </Link>
          )}
        </div>
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
