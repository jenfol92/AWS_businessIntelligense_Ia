import { isLocale } from "./i18n.ts";

/** First deployment's PAGE/UI policy. Does not authorize or restrict backend APIs. */
const MODULE_ROUTES = {
  dashboard: "/", login: "/login", orders: "/pedidos", suppliers: "/proveedores",
  logistics: "/logistica", finance: "/finanzas", coo: "/coo",
  amazonShipments: "/amazon/envios", amazonCompliance: "/amazon/cumplimiento",
  inventory: "/inventario", products: "/productos", planner: "/planificador",
  arrivals: "/planificador/llegadas",
  purchaseSuggestions: "/pedidos/sugeridos",
} as const;
export type PageModule = keyof typeof MODULE_ROUTES;
const PRODUCTION_MODULES: readonly PageModule[] = [
  "dashboard", "login", "orders", "suppliers", "logistics", "finance", "coo",
  "amazonShipments", "arrivals",
];
export function isModuleExposed(module: PageModule, environment = process.env.NODE_ENV): boolean {
  return environment !== "production" || PRODUCTION_MODULES.includes(module);
}
export function pagePathWithoutLocale(path: string): string {
  const pathname = path.split(/[?#]/,1)[0];
  const segments = pathname.split("/");
  if (isLocale(segments[1])) segments.splice(1,1);
  return segments.join("/").replace(/\/+$/, "") || "/";
}
export function isPageRouteExposed(path: string, environment = process.env.NODE_ENV): boolean {
  const route = pagePathWithoutLocale(path);
  // Deliberately leave API/static access to its existing owners and authorization.
  if (route === "/api" || route.startsWith("/api/") || route.startsWith("/_next/")) return true;
  if (environment !== "production") return true;
  const pageModule = (Object.keys(MODULE_ROUTES) as PageModule[])
    .sort((a,b) => MODULE_ROUTES[b].length - MODULE_ROUTES[a].length)
    .find(key => route === MODULE_ROUTES[key] || MODULE_ROUTES[key] !== "/" && route.startsWith(MODULE_ROUTES[key] + "/"));
  return pageModule !== undefined && isModuleExposed(pageModule,environment);
}
type NavigationItem = { path?: string; children?: NavigationItem[] };
/** Filters children first, removing empty groups. Development returns original navigation. */
export function filterExposedNavigation<T extends { items: NavigationItem[] }>(groups: T[], environment = process.env.NODE_ENV): T[] {
  if (environment !== "production") return groups;
  const filter = (items: NavigationItem[]): NavigationItem[] => items.flatMap(item => {
    if (item.path && !isPageRouteExposed(item.path,environment)) return [];
    if (item.children) {
      const children = filter(item.children); return children.length ? [{ ...item, children }] : [];
    }
    return [item];
  });
  return groups.map(group => ({ ...group, items: filter(group.items) })).filter(group => group.items.length > 0) as T[];
}
