import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function MakerPositionsPage() {
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Positions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            <p>Open positions will list covered call and cash-secured put exposure here.</p>
            <p>ITM and OTM state will sit beside each live position.</p>
            <p>Required settlement funds will surface before expiry settlement begins.</p>
            <p>Settlement readiness and settlement history stay on this hidden maker route.</p>
          </div>
          <div className="border border-dashed border-border p-4 text-sm text-muted-foreground">
            No maker positions are loaded yet. This tab is reserved for open positions,
            settlement readiness, and settlement history once underwriting and dashboard
            read models land.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default MakerPositionsPage;
