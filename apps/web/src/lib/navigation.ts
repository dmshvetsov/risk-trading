export type NavigationItem = {
  href: string;
  label: string;
  summary: string;
};

export const navigationItems: NavigationItem[] = [
  {
    href: "/",
    label: "Earn",
    summary: "Set a price. Get paid. Love either outcome.",
  },
  {
    href: "#",
    label: "Dashboard",
    summary: "Sold contracts dashboard",
  },
];
