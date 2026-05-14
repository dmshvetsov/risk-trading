import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, BriefcaseBusiness } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const routes = [
  {
    title: "Oracle States",
    to: "/",
    icon: Activity,
  },
  {
    title: "Positions",
    to: "/positions",
    icon: BriefcaseBusiness,
  },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="text-sm font-semibold">Risk Trading</div>
        <div className="text-xs text-sidebar-foreground/60">Prediction market monitor</div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarMenu aria-label="Main navigation">
            {routes.map((route) => {
              const Icon = route.icon;
              const isActive = pathname === route.to;

              return (
                <SidebarMenuButton asChild key={route.to}>
                  <Link
                    to={route.to}
                    activeOptions={{ exact: true }}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      isActive &&
                        "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span>{route.title}</span>
                  </Link>
                </SidebarMenuButton>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
