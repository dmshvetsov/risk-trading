import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-border bg-background text-foreground hover:bg-[#f7f7f7]",
        outline: "border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary: "border-transparent bg-primary text-primary-foreground hover:bg-[#1677e4]",
        ghost: "border-transparent hover:bg-accent hover:text-accent-foreground",
        link: "border-transparent p-0 text-primary underline-offset-4 hover:underline",
        destructive:
          "border-destructive bg-destructive text-white hover:bg-destructive/90 dark:text-destructive-foreground",
        cta: "border-transparent bg-primary text-primary-foreground hover:bg-[#1677e4] font-cta font-bold",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-8 px-6 text-base",
        xl: "h-12 px-6 text-base",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      data-slot="button"
      {...props}
    />
  );
}

export { buttonVariants };
