import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("annual section starts on chart view with mutually exclusive chart and list", async () => {
  const section = await read("modules/finance/components/AmazonAnnualPlanningSection.tsx");

  assert.match(section, /type AnnualView = "chart" \| "list"/);
  assert.match(section, /const \[view, setView\] = useState<AnnualView>\("chart"\)/);
  assert.match(section, /Cambiar a lista detallada/);
  assert.match(section, /Cambiar a gráfica/);
  assert.match(section, /view === "chart" \? "Cambiar a lista detallada" : "Cambiar a gráfica"/);
  assert.match(section, /\{view === "chart" \? \(/);
  assert.match(section, /\{view === "list" \? \(/);

  const barChartCount = (section.match(/<BarChart/g) ?? []).length;
  const tableCount = (section.match(/<table className="min-w-full text-left text-xs">/g) ?? []).length;
  assert.equal(barChartCount, 1, "expected a single BarChart instance");
  assert.equal(tableCount, 1, "expected a single annual table instance");

  const chartBlock = section.match(/\{view === "chart" \? \([\s\S]*?\) : null\}/)?.[0] ?? "";
  const listBlock = section.match(/\{view === "list" \? \([\s\S]*?\) : null\}/)?.[0] ?? "";
  assert.match(chartBlock, /<BarChart/);
  assert.doesNotMatch(chartBlock, /<table className="min-w-full text-left text-xs">/);
  assert.match(listBlock, /<table className="min-w-full text-left text-xs">/);
  assert.doesNotMatch(listBlock, /<BarChart/);
});

test("annual section keeps shared chartRows horizon and deferred detail interactions", async () => {
  const section = await read("modules/finance/components/AmazonAnnualPlanningSection.tsx");

  assert.match(section, /data\.amazonPlanningHorizonMonths/);
  assert.match(section, /buildAmazonAnnualChartRows/);
  assert.match(section, /chartRows\.map/);
  assert.match(section, /data=\{chartRows\}/);
  assert.match(section, /<Tooltip content=\{<ChartTooltip \/>\} \/>/);
  assert.match(section, /handleBarClick/);
  assert.match(section, /setReleaseMonth\(row\.month\)/);
  assert.match(section, /AmazonDeferredReleaseModal/);
  assert.doesNotMatch(section, /amazonTotal/);
  assert.doesNotMatch(section, /combinedKnown/);
  assert.doesNotMatch(section, /totalIngresos/);
});

test("annual view toggle is an accessible button", async () => {
  const section = await read("modules/finance/components/AmazonAnnualPlanningSection.tsx");

  assert.match(section, /type="button"/);
  assert.match(section, /onClick=\{\(\) => setView\(\(current\) => \(current === "chart" \? "list" : "chart"\)\)\}/);
});
