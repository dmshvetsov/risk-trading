import { Info } from "lucide-react";

import { cn } from "@/lib/utils";

export function Hint({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <span className={cn("group relative inline-flex items-center", className)}>
      <Info
        aria-label={children}
        className="size-3.5 text-muted-foreground"
        role="img"
      />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-56 -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-xs font-normal text-popover-foreground shadow-md group-hover:block group-focus-within:block">
        {children}
      </span>
    </span>
  );
}
