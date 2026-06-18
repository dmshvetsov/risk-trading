import { ErrorPanel } from "../components/error-panel";
import { LoadingPanel } from "../components/loading-panel";
import { PageSection } from "../components/page-section";

export function SharedStatesPage() {
  return (
    <div className="grid gap-6">
      <PageSection
        eyebrow="Shared states"
        title="Reusable loading and error shells"
        description="Future routes can reuse these states without rebuilding the page frame."
      >
        <LoadingPanel message="Loading boundaries are wired for future route and API work." />
        <ErrorPanel
          title="Shared recovery state"
          message="Error boundaries are wired and ready for later screens."
        />
      </PageSection>
    </div>
  );
}

export default SharedStatesPage;
