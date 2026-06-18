export type NavigationItem = {
  href: string;
  label: string;
  summary: string;
};

export const navigationItems: NavigationItem[] = [
  {
    href: "/",
    label: "Home",
    summary: "See supported assets and payout basics",
  },
  {
    href: "/taker",
    label: "Taker shell",
    summary: "Future seller flows mount here",
  },
  {
    href: "/maker",
    label: "Maker shell",
    summary: "Future maker routes mount here",
  },
  {
    href: "/states",
    label: "Shared states",
    summary: "Loading and error patterns live here",
  },
];
