export type NavigationItem = {
  href: string;
  label: string;
  summary: string;
};

export const navigationItems: NavigationItem[] = [
  {
    href: "/",
    label: "Earn",
    summary: "Get a live quote for the earning flow",
  },
  {
    href: "/maker",
    label: "Dashboard",
    summary: "Manage maker readiness screens",
  },
];
