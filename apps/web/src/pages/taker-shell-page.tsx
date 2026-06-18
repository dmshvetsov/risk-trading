import type { PropsWithChildren } from "react";

import {
  ListCard,
  MetricCard,
  PageSection,
  StatusStrip,
} from "../components/page-section";

export function TakerShellPage({ children }: PropsWithChildren) {
  return (
    <div className="page-stack">
      <PageSection
        eyebrow="Taker shell"
        title="Wallet-gated seller routes mount here"
        description="This route is intentionally generic. It holds the session frame, page rhythm, and extension points for later seller flows."
      >
        <StatusStrip>
          <MetricCard
            label="Session gate"
            value="Ready"
            hint="Connected-wallet checks plug in here."
          />
          <MetricCard
            label="Route slot"
            value="Ready"
            hint="Future RFQ and position screens mount here."
          />
          <MetricCard
            label="Copy style"
            value="Simple"
            hint="Seller-facing screens stay plain and direct."
          />
        </StatusStrip>
        <ListCard
          title="Foundation points"
          items={[
            { label: "Nested routes", value: "Can attach without shell rework" },
            { label: "Shared cards", value: "Reusable section and metric blocks" },
            { label: "Wallet header", value: "Available across all later screens" },
          ]}
        />
        {children}
      </PageSection>
    </div>
  );
}

export default TakerShellPage;
