import { LoaderCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LoadingPanel({ message }: { message: string }) {
  return (
    <Card aria-live="polite">
      <CardHeader className="flex flex-row items-start gap-4">
        <LoaderCircle className="mt-1 size-5 animate-spin text-muted-foreground" />
        <div className="grid gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Loading
          </p>
          <CardTitle>{message}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-muted-foreground">
        Shared loading state is wired and ready for future API screens.
      </CardContent>
    </Card>
  );
}
