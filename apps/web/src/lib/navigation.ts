export type NavigationItem = {
  href: string;
  label: string;
  summary: string;
};

export const navigationItems: NavigationItem[] = [
  {
    href: "/",
    label: "Earn",
    summary: "Static earning flow preview",
  },
  {
    href: "/taker",
    label: "Dashboard",
    summary: "Preview the buyer-side shell",
  },
];
