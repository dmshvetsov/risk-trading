import type { PropsWithChildren } from "react";

import {
  ListCard,
  MetricCard,
  PageSection,
  StatusStrip,
} from "../components/page-section";

export function MakerShellPage({ children }: PropsWithChildren) {
  return (
    <div className="grid gap-6">
      <PageSection
        eyebrow="Maker shell"
        title="Professional options language starts here"
        description="This route keeps the foundation generic while setting the terminology for covered call, cash-secured put, ITM, OTM, and settlement workflows."
      >
        <StatusStrip>
          <MetricCard
            label="Vocabulary"
            value="Covered call"
            hint="Maker surfaces can use trader language."
          />
          <MetricCard
            label="Vocabulary"
            value="Cash-secured put"
            hint="Risk and side-specific labels fit here."
          />
          <MetricCard
            label="Vocabulary"
            value="ITM / OTM"
            hint="Moneyness status plugs into the same shell."
          />
        </StatusStrip>
        <ListCard
          title="Foundation points"
          items={[
            { label: "Route slot", value: "Open positions and history mount here" },
            { label: "Operations slot", value: "Settlement and funding actions mount here" },
            { label: "Shared shell", value: "Uses the same header, config, and states" },
          ]}
        />
        {children}
      </PageSection>
    </div>
  );
}

export default MakerShellPage;
