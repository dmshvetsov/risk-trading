import { cloneElement, isValidElement, type ComponentProps, type ReactElement } from "react";

import { cn } from "@/lib/utils";

function Sidebar({ className, ...props }: ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "hidden min-h-screen w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex lg:flex-col",
        className,
      )}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("border-b border-sidebar-border p-4", className)} {...props} />;
}

function SidebarContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex min-h-0 flex-1 flex-col gap-2 p-3", className)} {...props} />;
}

function SidebarGroup({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />;
}

function SidebarGroupLabel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "px-2 py-1.5 text-xs font-medium text-sidebar-foreground/60",
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: ComponentProps<"nav">) {
  return <nav className={cn("flex flex-col gap-1", className)} {...props} />;
}

type SidebarMenuButtonProps = ComponentProps<"a"> & {
  asChild?: boolean;
};

function SidebarMenuButton({
  asChild,
  className,
  children,
  ...props
}: SidebarMenuButtonProps) {
  const buttonClassName = cn(
    "flex h-9 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground",
    className,
  );

  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{ className?: string }>;

    return cloneElement(child, {
      className: cn(buttonClassName, child.props.className),
      ...props,
    });
  }

  return (
    <a
      className={buttonClassName}
      {...props}
    >
      {children}
    </a>
  );
}

function SidebarInset({ className, ...props }: ComponentProps<"main">) {
  return <main className={cn("min-w-0 flex-1", className)} {...props} />;
}

export {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
};
