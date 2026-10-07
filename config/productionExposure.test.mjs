import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import ts from "typescript";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as policy from "./productionExposure.ts";

// Execute actual TS/TSX owners with offline dependencies; never load DB/Amazon clients.
function load(file, dependencies) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
function environment(value, run) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try { return run(); } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}
const blocked = ["/inventario", "/inventario/stock/pais", "/inventario/forecast",
  "/productos", "/productos/new", "/productos/123", "/productos/123/edit",
  "/productos/sku.with.dot", "/planificador", "/amazon/cumplimiento", "/amazon/cumplimiento/detail",
  "/planificador/anual", "/planificador/logistica", "/pedidos/sugeridos", "/pedidos/sugeridos/detail"];
for (const path of blocked) test(`page policy: ${path}`, () => {
  for (const prefix of ["", "/es", "/en"]) {
    assert.equal(policy.isPageRouteExposed(prefix + path, "production"), false);
    assert.equal(policy.isPageRouteExposed(prefix + path + "/?test=1", "production"), false);
    assert.equal(policy.isPageRouteExposed(prefix + path, "development"), true);
  }
});
test("production allowlist preserves normal Orders, Finance, Logistics and internal APIs", () => {
  for (const path of ["/", "/login", "/pedidos", "/finanzas/planificacion", "/logistica",
    "/proveedores", "/coo", "/amazon/envios", "/planificador/llegadas",
    "/api/orders/products-search", "/api/products/123", "/api/inventory/comparison",
    "/api/cron/amazon/orders-sync/recover", "/api/planner/summary"])
    assert.equal(policy.isPageRouteExposed(path, "production"), true, path);
  assert.equal(policy.isPageRouteExposed("/new-module", "production"), false);
  assert.equal(policy.isPageRouteExposed("/new-module", "development"), true);
});
test("navigation filters children without mutation; development keeps original tree", () => {
  const groups = [{ items: [{ path: "/pedidos" }, { path: "/productos" },
    { children: [{ path: "/planificador" }, { path: "/planificador/anual" }] }] }];
  assert.equal(policy.filterExposedNavigation(groups, "development"), groups);
  assert.deepEqual(policy.filterExposedNavigation(groups, "production"), [{ items: [{ path: "/pedidos" }] }]);
  assert.equal(groups[0].items.length, 3);
});
test("actual Sidebar renders production allowlist and original development entries", () => {
  const icon = () => null;
  const Sidebar = load("shared/layout/Sidebar.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/navigation": { useParams: () => ({ locale: "es" }), usePathname: () => "/es/pedidos" },
    "lucide-react": new Proxy({}, { get: () => icon }),
    "tailwind-merge": { twMerge: (...args) => args.join(" ") },
    "@/config/i18n": { DEFAULT_LOCALE: "es", isLocale: value => ["es", "en"].includes(value) },
    "@/config/productionExposure": policy,
  }).default;
  const render = mode => environment(mode, () => renderToStaticMarkup(React.createElement(Sidebar)));
  const development = render("development");
  const production = render("production");
  for (const route of ["inventario", "productos", "planificador"]) {
    assert.ok(development.includes(`/es/${route}`));
    assert.ok(!production.includes(`href="/es/${route}"`));
  }
  assert.ok(development.includes('/es/amazon/cumplimiento'));
  assert.ok(!production.includes('/es/amazon/cumplimiento'));
  assert.ok(!production.includes('/es/planificador/anual'));
  assert.ok(!production.includes('/es/planificador/logistica'));
  for (const route of ["pedidos", "finanzas", "logistica", "amazon/envios", "planificador/llegadas"])
    assert.ok(production.includes(`/es/${route}`), route);
});
test("server guard and actual layouts throw notFound before rendering in production", () => {
  const sentinel = new Error("NOT_FOUND");
  const guard = load("server/productionPageGuard.ts", {
    "next/navigation": { notFound: () => { throw sentinel; } },
    "@/config/productionExposure": policy,
  });
  for (const route of ["inventario", "productos", "planificador/(restricted)", "pedidos/sugeridos", "amazon/cumplimiento"]) {
    const layout = load(`app/[locale]/(dashboard)/${route}/layout.tsx`, {
      "@/server/productionPageGuard": guard,
    }).default;
    environment("production", () => assert.throws(() => layout({ children: "PAGE" }), error => error === sentinel));
    environment("development", () => assert.equal(layout({ children: "PAGE" }), "PAGE"));
  }
});
test("Arrivals layout is outside the restricted Planner ancestor and permits both environments", () => {
  const base = "app/[locale]/(dashboard)/planificador/";
  assert.equal(existsSync(base + "layout.tsx"), false, "No blocking parent may wrap Arrivals");
  for (const page of ["page.tsx", "anual/page.tsx", "logistica/page.tsx"])
    assert.ok(existsSync(base + "(restricted)/" + page));
  assert.ok(existsSync(base + "llegadas/page.tsx"));
  const guard = load("server/productionPageGuard.ts", {
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); } },
    "@/config/productionExposure": policy,
  });
  const layout = load(base + "llegadas/layout.tsx", { "@/server/productionPageGuard": guard }).default;
  for (const mode of ["production", "development"])
    environment(mode, () => assert.equal(layout({ children: "ARRIVALS" }), "ARRIVALS"));
});
test("explicit Arrivals and Amazon Shipments allowlist survives locales and subroutes", () => {
  for (const mode of ["production", "development"])
    for (const prefix of ["", "/es", "/en"])
      for (const route of ["/planificador/llegadas", "/planificador/llegadas/detail", "/amazon/envios"])
        assert.equal(policy.isPageRouteExposed(prefix + route, mode), true);
  assert.equal(policy.isPageRouteExposed("/planificador/llegadas-other", "production"), false);
  assert.equal(policy.isPageRouteExposed("/api/policies/alerts/sync", "production"), true);
});
test("actual middleware blocks before intl/Supabase; development preserves locale redirect", async () => {
  class Response {
    constructor(body, options) { this.status = options.status; }
    static redirect(url) { return { status: 307, url: url.href }; }
  }
  const middleware = load("middleware.ts", {
    "next-intl/middleware": { __esModule: true, default: () => { throw new Error("Should not run intl"); } },
    "@supabase/ssr": { createServerClient: () => { throw new Error("Should not contact DB"); } },
    "next/server": { NextResponse: Response },
    "@/config/productionExposure": policy,
    "@/config/i18n": { DEFAULT_LOCALE: "es", LOCALES: ["es", "en"], LOCALE_COOKIE_NAME: "locale", isLocale: value => ["es", "en"].includes(value) },
  }).middleware;
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    for (const path of blocked) {
      const response = await middleware({ nextUrl: { pathname: "/es" + path, search: "" } });
      assert.equal(response.status, 404);
    }
    process.env.NODE_ENV = "development";
    const response = await middleware({ nextUrl: { pathname: "/inventario", search: "" },
      url: "http://localhost/inventario", cookies: { get: () => undefined } });
    assert.equal(response.url, "http://localhost/es/inventario");
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});
test("Dashboard and Orders only hide blocked navigation and suggestion UI", () => {
  const dashboard = readFileSync("modules/dashboard/components/DashboardBI.tsx", "utf8");
  assert.match(dashboard, /isPageRouteExposed\("\/inventario"\) && <Link/);
  assert.match(dashboard, /if \(!isPageRouteExposed\(href\)\) return null/);
  const orders = readFileSync("app/[locale]/(dashboard)/pedidos/page.tsx", "utf8");
  assert.match(orders, /isModuleExposed\("purchaseSuggestions"\) && <button/);
  assert.match(orders, /isModuleExposed\("purchaseSuggestions"\) && activeTab === "sugerencias"/);
  assert.match(orders, /isModuleExposed\("purchaseSuggestions"\) && <OrderDraftBasket/);
  assert.match(orders, /useOrderSuggestions\(activeTab === "sugerencias"\)/);
});
