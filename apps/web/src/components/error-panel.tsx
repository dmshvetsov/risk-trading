import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ErrorPanel({
  title,
  message,
  actions,
}: {
  title: string;
  message: string;
  actions?: ReactNode;
}) {
  return (
    <Card className="border-destructive/30 bg-destructive/5" role="alert">
      <CardHeader className="flex flex-row items-start gap-4">
        <AlertTriangle className="mt-1 size-5 text-destructive" />
        <div className="grid gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Error
          </p>
          <CardTitle>{title}</CardTitle>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </CardHeader>
      {actions ? <CardContent className="pt-0">{actions}</CardContent> : null}
    </Card>
  );
}
