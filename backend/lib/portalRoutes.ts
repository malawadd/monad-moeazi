export type PortalTone = "sky" | "orange" | "mint" | "lilac" | "rose";

export type PortalRouteMeta = {
  match: string;
  title: string;
  subtitle: string;
  tone: PortalTone;
  navHref: string;
  exact?: boolean;
};

export type PortalNavGroup = {
  label: string;
  items: Array<{ href: string; label: string }>;
};

export const portalNavGroups: PortalNavGroup[] = [
  {
    label: "Agent",
    items: [
      { href: "/agents", label: "My teams" },
      { href: "/agents/models", label: "Models & keys" },
      { href: "/agents/monitoring", label: "Monitoring" },
      { href: "/agents/approvals", label: "Approvals" },
      { href: "/agents/activity", label: "Agent activity" },
      { href: "/agents/policy", label: "Guardrails" },
      { href: "/credits", label: "Credits" },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/dashboard", label: "Overview" },
      { href: "/profile/wallet", label: "Wallet" },
      { href: "/deposits", label: "Deposits" },
      { href: "/withdrawals", label: "Withdrawals" },
      { href: "/settings", label: "Settings" },
    ],
  },
  {
    label: "Trading",
    items: [
      { href: "/trade", label: "Terminal" },
      { href: "/swap", label: "Spot swap" },
      { href: "/venues", label: "Venues" },
      { href: "/positions", label: "Positions" },
      { href: "/activity", label: "Execution activity" },
    ],
  },
  {
    label: "Safety",
    items: [
      { href: "/risk", label: "Risk" },
      { href: "/kill", label: "Emergency stop" },
    ],
  },
];

const portalRouteMeta: PortalRouteMeta[] = [
  {
    match: "/agents/monitoring/",
    title: "Decision trace",
    subtitle: "Evidence to action, without hidden reasoning",
    tone: "sky",
    navHref: "/agents/monitoring",
  },
  {
    match: "/agents/monitoring",
    title: "Agent monitoring",
    subtitle: "Every model call, decision, cost, and downstream action",
    tone: "sky",
    navHref: "/agents/monitoring",
  },
  {
    match: "/agents/models",
    title: "Models & keys",
    subtitle: "Connect once. Choose models per team.",
    tone: "sky",
    navHref: "/agents/models",
  },
  {
    match: "/agents/approvals",
    title: "Approvals",
    subtitle: "Expiring proposals, fresh checks",
    tone: "orange",
    navHref: "/agents/approvals",
  },
  {
    match: "/agents/activity",
    title: "Agent activity",
    subtitle: "Analyses, simulations, proposals, and trades",
    tone: "sky",
    navHref: "/agents/activity",
  },
  {
    match: "/agents/policy",
    title: "Guardrails",
    subtitle: "Deterministic limits before every order",
    tone: "lilac",
    navHref: "/agents/policy",
  },
  {
    match: "/agents/create",
    title: "Create team",
    subtitle: "Start with a preset, then review every limit",
    tone: "sky",
    navHref: "/agents",
  },
  {
    match: "/agents",
    title: "My teams",
    subtitle: "Your teams",
    tone: "sky",
    navHref: "/agents",
    exact: true,
  },
  {
    match: "/agents/",
    title: "My teams",
    subtitle: "Your team",
    tone: "sky",
    navHref: "/agents",
  },
  {
    match: "/credits",
    title: "Credits",
    subtitle: "Upfront estimates and immutable usage",
    tone: "sky",
    navHref: "/credits",
  },
  {
    match: "/dashboard",
    title: "Overview",
    subtitle: "Managed strategy account health and execution state",
    tone: "sky",
    navHref: "/dashboard",
  },
  {
    match: "/profile/wallet",
    title: "Wallet",
    subtitle: "Particle or Magic signer · Arbitrum strategy network",
    tone: "sky",
    navHref: "/profile/wallet",
  },
  {
    match: "/deposits",
    title: "Deposits",
    subtitle: "Live wallet inventory, funding rails, and gas reserve visibility",
    tone: "orange",
    navHref: "/deposits",
  },
  {
    match: "/withdrawals",
    title: "Withdrawals",
    subtitle: "Wallet balances and settlement tracking",
    tone: "mint",
    navHref: "/withdrawals",
  },
  {
    match: "/settings",
    title: "Settings",
    subtitle: "Strategy guardrails and execution tuning",
    tone: "lilac",
    navHref: "/settings",
  },
  {
    match: "/swap",
    title: "Trading",
    subtitle: "Spot swap",
    tone: "sky",
    navHref: "/swap",
  },
  {
    match: "/venues",
    title: "Trading",
    subtitle: "Venues",
    tone: "sky",
    navHref: "/venues",
  },
  {
    match: "/positions",
    title: "Positions",
    subtitle: "LP and hedge inventory across managed venues",
    tone: "lilac",
    navHref: "/positions",
  },
  {
    match: "/activity",
    title: "Activity",
    subtitle: "Execution ledger and operator audit stream",
    tone: "rose",
    navHref: "/activity",
  },
  {
    match: "/risk",
    title: "Risk",
    subtitle: "Alerts, exposure, and pause state",
    tone: "rose",
    navHref: "/risk",
  },
  {
    match: "/kill",
    title: "Emergency stop",
    subtitle: "Immediately pause trading activity and surface a critical alert",
    tone: "rose",
    navHref: "/kill",
  },
];

function matchesRoute(pathname: string, route: PortalRouteMeta) {
  if (route.exact) return pathname === route.match;
  if (route.match.endsWith("/")) return pathname.startsWith(route.match);
  return pathname === route.match || pathname.startsWith(`${route.match}/`);
}

export function getPortalRouteMeta(pathname: string): PortalRouteMeta {
  return portalRouteMeta.find((route) => matchesRoute(pathname, route)) ?? {
    match: pathname,
    title: "Moeazi",
    subtitle: "Managed strategy operations",
    tone: "sky",
    navHref: "/dashboard",
  };
}

export function isPortalNavActive(pathname: string, href: string) {
  return getPortalRouteMeta(pathname).navHref === href;
}
