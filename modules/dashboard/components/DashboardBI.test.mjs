import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./DashboardBI.tsx", import.meta.url), "utf8");
const localeIndexSource = fs.readFileSync(
  new URL("../../../app/[locale]/page.tsx", import.meta.url),
  "utf8",
);

test("dashboard is an inventory read-only decision surface", () => {
  assert.match(source, /\/api\/inventory\/comparison/);
  assert.match(source, /No ejecuta compras ni pagos/);
  assert.match(source, /Cola de decisiones de inventario/);
  assert.doesNotMatch(source, /\/api\/finance\/planning/);
  assert.doesNotMatch(source, /method:\s*["']POST["']/);
  assert.doesNotMatch(source, /method:\s*["']PUT["']/);
  assert.doesNotMatch(source, /method:\s*["']DELETE["']/);
});

test("dashboard exposes canonical module handoffs", () => {
  assert.ok(source.includes("/${locale}/inventario"));
  assert.ok(source.includes("/${locale}/planificador"));
  assert.ok(source.includes("/${locale}/finanzas/planificacion"));
});

test("locale root renders the decision dashboard instead of redirecting to products", () => {
  assert.match(localeIndexSource, /<DashboardBI \/>/);
  assert.doesNotMatch(localeIndexSource, /redirect\(/);
  assert.doesNotMatch(localeIndexSource, /productos/);
});
