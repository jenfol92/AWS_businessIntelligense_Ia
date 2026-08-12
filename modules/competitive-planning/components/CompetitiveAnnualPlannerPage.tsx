"use client";

import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { BarChart3, Clipboard, Download, Plus, Target, Trash2 } from "lucide-react";

type Scenario = "conservative" | "base" | "aggressive";

type ProductInput = {
  id: string;
  name: string;
  country: string;
  stock: number;
  leadTimeDays: number;
  unitCost: number;
  logisticsCost: number;
  amazonFee: number;
  minMarginPct: number;
  capturePct: number;
  safetyDays: number;
  moq: number;
  cartonMultiple: number;
};

type CompetitorInput = {
  id: string;
  productId: string;
  country: string;
  asin: string;
  title: string;
  price: number;
  monthlyUnits: number;
  revenue: number;
  bsr: number;
  reviews: number;
  rating: number;
};

type Stats = {
  count: number;
  meanUnits: number | null;
  modalUnits: number | null;
  p75Units: number | null;
  meanPrice: number | null;
  modalPrice: number | null;
};

type MonthlyPlanLine = {
  product: ProductInput;
  monthLabel: string;
  monthIndex: number;
  openingStock: number;
  forecastUnits: number;
  modalForecastUnits: number;
  orderUnits: number;
  arrivalMonthLabel: string;
  closingStock: number;
  targetPrice: number | null;
  minProfitablePrice: number;
  expectedRevenue: number | null;
};

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const SEASONALITY = [0.92, 0.88, 0.95, 1, 1.03, 1.04, 0.98, 0.96, 1.05, 1.12, 1.25, 1.35];

const DEFAULT_PRODUCT: ProductInput = {
  id: "PROD-A-ES",
  name: "Producto A",
  country: "ES",
  stock: 320,
  leadTimeDays: 75,
  unitCost: 8.2,
  logisticsCost: 1.1,
  amazonFee: 4.5,
  minMarginPct: 25,
  capturePct: 8,
  safetyDays: 30,
  moq: 300,
  cartonMultiple: 50,
};

const DEFAULT_COMPETITORS: CompetitorInput[] = [
  {
    id: "c-1",
    productId: "PROD-A-ES",
    country: "ES",
    asin: "B0AAAAAA",
    title: "Competidor 1",
    price: 24.99,
    monthlyUnits: 850,
    revenue: 21241,
    bsr: 3450,
    reviews: 420,
    rating: 4.5,
  },
  {
    id: "c-2",
    productId: "PROD-A-ES",
    country: "ES",
    asin: "B0BBBBBB",
    title: "Competidor 2",
    price: 22.99,
    monthlyUnits: 620,
    revenue: 14253,
    bsr: 5200,
    reviews: 180,
    rating: 4.3,
  },
  {
    id: "c-3",
    productId: "PROD-A-ES",
    country: "ES",
    asin: "B0CCCCCC",
    title: "Competidor 3",
    price: 24.49,
    monthlyUnits: 790,
    revenue: 19347,
    bsr: 3820,
    reviews: 310,
    rating: 4.4,
  },
];

function parseNum(value: string | number | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const n = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function fmtNum(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("es-ES", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
}

function mean(values: number[]): number | null {
  const filtered = values.filter((v) => v > 0);
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
}

function percentile(values: number[], p: number): number | null {
  const filtered = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (filtered.length === 0) return null;
  const idx = Math.min(filtered.length - 1, Math.ceil((p / 100) * filtered.length) - 1);
  return filtered[idx] ?? null;
}

function modeByBucket(values: number[], bucketSize: number): number | null {
  const buckets = new Map<number, { count: number; sum: number }>();
  for (const value of values) {
    if (value <= 0) continue;
    const bucket = Math.round(value / bucketSize) * bucketSize;
    const current = buckets.get(bucket) ?? { count: 0, sum: 0 };
    buckets.set(bucket, { count: current.count + 1, sum: current.sum + value });
  }
  let winner: { bucket: number; count: number; sum: number } | null = null;
  for (const [bucket, data] of Array.from(buckets.entries())) {
    if (!winner || data.count > winner.count || (data.count === winner.count && bucket < winner.bucket)) {
      winner = { bucket, ...data };
    }
  }
  return winner ? winner.sum / winner.count : null;
}

function roundUp(value: number, multiple: number): number {
  const m = Math.max(1, Math.round(multiple || 1));
  return Math.ceil(Math.max(0, value) / m) * m;
}

function calculateStats(rows: CompetitorInput[]): Stats {
  return {
    count: rows.length,
    meanUnits: mean(rows.map((r) => r.monthlyUnits)),
    modalUnits: modeByBucket(rows.map((r) => r.monthlyUnits), 50),
    p75Units: percentile(rows.map((r) => r.monthlyUnits), 75),
    meanPrice: mean(rows.map((r) => r.price)),
    modalPrice: modeByBucket(rows.map((r) => r.price), 1),
  };
}

function monthLabelFromOffset(offset: number): string {
  const base = new Date();
  const date = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  return `${MONTHS[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`;
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if ((char === "," || char === ";") && !quoted) {
      out.push(current.trim().replace(/^"|"$/g, ""));
      current = "";
    } else current += char;
  }
  out.push(current.trim().replace(/^"|"$/g, ""));
  return out;
}

function getMapped(row: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const value = row[alias];
    if (value != null && value.trim() !== "") return value;
  }
  return "";
}

function parseCompetitorCsv(raw: string): CompetitorInput[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!).map(normalizeKey);

  return lines.slice(1).flatMap((line, index) => {
    const values = splitCsvLine(line);
    const mapped: Record<string, string> = {};
    headers.forEach((header, i) => {
      mapped[header] = values[i] ?? "";
    });

    const productId =
      getMapped(mapped, ["producto", "product", "sku", "product_id", "producto_id"]) || "PRODUCTO-SIN-SKU";
    const country = (getMapped(mapped, ["pais", "country", "marketplace", "marketplace_country"]) || "ES").toUpperCase();
    const asin = getMapped(mapped, ["asin", "competitor_asin"]);
    if (!asin) return [];

    return [
      {
        id: `csv-${Date.now()}-${index}`,
        productId,
        country,
        asin,
        title: getMapped(mapped, ["titulo", "title", "competitor_title"]),
        price: parseNum(getMapped(mapped, ["precio", "price", "sale_price"])),
        monthlyUnits: parseNum(getMapped(mapped, ["ventas_mensuales", "monthly_units", "estimated_monthly_units", "units", "sales"])),
        revenue: parseNum(getMapped(mapped, ["revenue", "ingresos", "estimated_monthly_revenue"])),
        bsr: parseNum(getMapped(mapped, ["bsr", "rank"])),
        reviews: parseNum(getMapped(mapped, ["reviews", "review_count", "resenas"])),
        rating: parseNum(getMapped(mapped, ["rating", "valoracion"])),
      },
    ];
  });
}

function scenarioMonthlyUnits(stats: Stats, scenario: Scenario): number {
  const base = stats.meanUnits ?? stats.modalUnits ?? 0;
  if (scenario === "conservative") return Math.min(base, stats.modalUnits ?? base);
  if (scenario === "aggressive") return Math.max(base, stats.p75Units ?? base);
  return base;
}

function targetPrice(product: ProductInput, stats: Stats): { target: number | null; min: number } {
  const totalCost = product.unitCost + product.logisticsCost + product.amazonFee;
  const margin = Math.min(95, Math.max(0, product.minMarginPct)) / 100;
  const min = totalCost / (1 - margin);
  const competitorAnchor = stats.modalPrice ?? stats.meanPrice;
  if (competitorAnchor == null) return { target: min, min };
  return { target: Math.max(min, competitorAnchor - 0.01), min };
}

function buildPlan(products: ProductInput[], competitors: CompetitorInput[], scenario: Scenario): MonthlyPlanLine[] {
  const lines: MonthlyPlanLine[] = [];

  for (const product of products) {
    const rows = competitors.filter(
      (c) => c.productId === product.id && c.country.toUpperCase() === product.country.toUpperCase(),
    );
    const stats = calculateStats(rows);
    const monthlyAnchor = scenarioMonthlyUnits(stats, scenario);
    const modalAnchor = stats.modalUnits ?? monthlyAnchor;
    const capture = Math.max(0, product.capturePct) / 100;
    const leadMonths = Math.max(0, Math.ceil(product.leadTimeDays / 30));
    const safetyMonths = Math.max(0, product.safetyDays / 30);
    const incoming = Array.from({ length: 18 }, () => 0);
    const monthlyDemand = Array.from({ length: 18 }, (_, i) => {
      const month = new Date(new Date().getFullYear(), new Date().getMonth() + i, 1).getMonth();
      return Math.round(monthlyAnchor * capture * SEASONALITY[month]!);
    });
    const monthlyModalDemand = Array.from({ length: 18 }, (_, i) => {
      const month = new Date(new Date().getFullYear(), new Date().getMonth() + i, 1).getMonth();
      return Math.round(modalAnchor * capture * SEASONALITY[month]!);
    });
    let stock = Math.max(0, product.stock);
    const price = targetPrice(product, stats);

    for (let i = 0; i < 12; i += 1) {
      stock += incoming[i] ?? 0;
      const openingStock = stock;
      const forecastUnits = monthlyDemand[i] ?? 0;
      const modalForecastUnits = monthlyModalDemand[i] ?? 0;
      const soldUnits = Math.min(stock, forecastUnits);
      stock -= soldUnits;

      const arrivalIndex = i + leadMonths;
      const targetWindowMonths = Math.max(2, Math.ceil(leadMonths + safetyMonths + 1));
      const targetAtArrival = monthlyDemand.slice(arrivalIndex, arrivalIndex + targetWindowMonths).reduce((sum, v) => sum + v, 0);
      const projectedIncomingBeforeArrival = incoming.slice(i + 1, arrivalIndex + 1).reduce((sum, v) => sum + v, 0);
      const projectedStockAtArrival = Math.max(0, stock + projectedIncomingBeforeArrival);
      const rawOrder = Math.max(0, targetAtArrival - projectedStockAtArrival);
      const orderUnits = rawOrder > 0 ? Math.max(product.moq, roundUp(rawOrder, product.cartonMultiple)) : 0;

      if (arrivalIndex < incoming.length) incoming[arrivalIndex] += orderUnits;

      lines.push({
        product,
        monthLabel: monthLabelFromOffset(i),
        monthIndex: i,
        openingStock,
        forecastUnits,
        modalForecastUnits,
        orderUnits,
        arrivalMonthLabel: monthLabelFromOffset(arrivalIndex),
        closingStock: stock,
        targetPrice: price.target,
        minProfitablePrice: price.min,
        expectedRevenue: price.target != null ? forecastUnits * price.target : null,
      });
    }
  }

  return lines;
}

function toCsv(lines: MonthlyPlanLine[]): string {
  const headers = [
    "producto",
    "pais",
    "mes",
    "forecast_media_uds",
    "forecast_moda_uds",
    "comprar_uds",
    "llegada_estimada",
    "stock_inicio",
    "stock_fin",
    "precio_objetivo",
    "precio_min_margen",
    "revenue_estimado",
  ];
  const rows = lines.map((line) =>
    [
      line.product.name,
      line.product.country,
      line.monthLabel,
      line.forecastUnits,
      line.modalForecastUnits,
      line.orderUnits,
      line.arrivalMonthLabel,
      line.openingStock,
      line.closingStock,
      line.targetPrice?.toFixed(2) ?? "",
      line.minProfitablePrice.toFixed(2),
      line.expectedRevenue?.toFixed(2) ?? "",
    ].join(";"),
  );
  return [headers.join(";"), ...rows].join("\n");
}

function downloadCsv(lines: MonthlyPlanLine[]) {
  const blob = new Blob([toCsv(lines)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "planificacion-anual-amazon.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function updateNumber<T extends object>(value: string, key: keyof T, setter: (patch: Partial<T>) => void) {
  setter({ [key]: parseNum(value) } as Partial<T>);
}

export function CompetitiveAnnualPlannerPage() {
  const [products, setProducts] = useState<ProductInput[]>([DEFAULT_PRODUCT]);
  const [competitors, setCompetitors] = useState<CompetitorInput[]>(DEFAULT_COMPETITORS);
  const [scenario, setScenario] = useState<Scenario>("base");
  const [csv, setCsv] = useState("");
  const [csvMessage, setCsvMessage] = useState<string | null>(null);

  const statsByProduct = useMemo(() => {
    const map = new Map<string, Stats>();
    for (const product of products) {
      map.set(
        product.id,
        calculateStats(
          competitors.filter(
            (c) => c.productId === product.id && c.country.toUpperCase() === product.country.toUpperCase(),
          ),
        ),
      );
    }
    return map;
  }, [competitors, products]);

  const plan = useMemo(() => buildPlan(products, competitors, scenario), [competitors, products, scenario]);
  const totalOrderUnits = plan.reduce((sum, line) => sum + line.orderUnits, 0);
  const totalRevenue = plan.reduce((sum, line) => sum + (line.expectedRevenue ?? 0), 0);
  const productsWithCompetitors = products.filter((p) => (statsByProduct.get(p.id)?.count ?? 0) > 0).length;
  const nextOrders = plan.filter((line) => line.monthIndex === 0 && line.orderUnits > 0);

  function patchProduct(id: string, patch: Partial<ProductInput>) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function patchCompetitor(id: string, patch: Partial<CompetitorInput>) {
    setCompetitors((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function handleImportCsv() {
    const rows = parseCompetitorCsv(csv);
    if (rows.length === 0) {
      setCsvMessage("No he encontrado filas validas. Revisa cabeceras como producto,pais,asin,precio,ventas_mensuales.");
      return;
    }
    setCompetitors((prev) => [...prev, ...rows]);
    setProducts((prev) => {
      const existing = new Set(prev.map((p) => `${p.id}|${p.country}`));
      const additions: ProductInput[] = [];
      for (const row of rows) {
        const key = `${row.productId}|${row.country}`;
        if (existing.has(key)) continue;
        existing.add(key);
        additions.push({ ...DEFAULT_PRODUCT, id: row.productId, name: row.productId, country: row.country, stock: 0 });
      }
      return [...prev, ...additions];
    });
    setCsv("");
    setCsvMessage(`${rows.length} competidores importados.`);
  }

  function addProduct() {
    const id = `PROD-${products.length + 1}`;
    setProducts((prev) => [...prev, { ...DEFAULT_PRODUCT, id, name: `Producto ${products.length + 1}`, stock: 0 }]);
  }

  function addCompetitor(productId = products[0]?.id ?? "PROD-1") {
    const product = products.find((p) => p.id === productId) ?? products[0];
    setCompetitors((prev) => [
      ...prev,
      {
        id: `manual-${Date.now()}`,
        productId,
        country: product?.country ?? "ES",
        asin: "B0",
        title: "",
        price: 0,
        monthlyUnits: 0,
        revenue: 0,
        bsr: 0,
        reviews: 0,
        rating: 0,
      },
    ]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-blue-700">Amazon benchmarking</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
            Planificacion anual por competidores
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Introduce ASINs, ventas estimadas, precios, costes y lead time. El panel calcula media,
            moda, precio objetivo y compras mensuales por pais/producto.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["conservative", "base", "aggressive"] as Scenario[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setScenario(value)}
              className={
                scenario === value
                  ? "rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white"
                  : "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              }
            >
              {value === "conservative" ? "Conservador" : value === "base" ? "Base" : "Agresivo"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard icon={Target} label="Productos con benchmark" value={`${productsWithCompetitors}/${products.length}`} />
        <KpiCard icon={BarChart3} label="Compra anual sugerida" value={`${fmtNum(totalOrderUnits)} uds`} />
        <KpiCard icon={Clipboard} label="Ordenes este mes" value={`${nextOrders.length}`} />
        <KpiCard icon={Download} label="Revenue estimado" value={fmtMoney(totalRevenue)} />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Importar datos Helium10</h2>
            <p className="mt-1 text-sm text-slate-600">
              Pega CSV con cabeceras: producto, pais, asin, precio, ventas_mensuales, revenue, bsr, reviews, rating.
            </p>
          </div>
          <button
            type="button"
            onClick={handleImportCsv}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Importar CSV
          </button>
        </div>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          className="mt-4 min-h-28 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          placeholder="producto,pais,asin,precio,ventas_mensuales,revenue,bsr,reviews,rating"
        />
        {csvMessage ? <p className="mt-2 text-sm text-slate-600">{csvMessage}</p> : null}
      </section>

      <ProductTable
        products={products}
        statsByProduct={statsByProduct}
        patchProduct={patchProduct}
        removeProduct={(id) => setProducts((prev) => prev.filter((p) => p.id !== id))}
        addProduct={addProduct}
      />

      <CompetitorTable
        products={products}
        competitors={competitors}
        patchCompetitor={patchCompetitor}
        removeCompetitor={(id) => setCompetitors((prev) => prev.filter((c) => c.id !== id))}
        addCompetitor={() => addCompetitor()}
      />

      <PlanTable plan={plan} />
    </div>
  );
}

function ProductTable({
  products,
  statsByProduct,
  patchProduct,
  removeProduct,
  addProduct,
}: {
  products: ProductInput[];
  statsByProduct: Map<string, Stats>;
  patchProduct: (id: string, patch: Partial<ProductInput>) => void;
  removeProduct: (id: string) => void;
  addProduct: () => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Productos y parametros</h2>
          <p className="mt-1 text-sm text-slate-600">Lead time, costes, margen y captura se aplican por pais/producto.</p>
        </div>
        <button type="button" onClick={addProduct} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <Plus className="h-4 w-4" />
          Producto
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1080px] w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Pais</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Coste</th>
              <th className="px-3 py-2">Logistica</th>
              <th className="px-3 py-2">Amazon fee</th>
              <th className="px-3 py-2">Margen min.</th>
              <th className="px-3 py-2">Captura</th>
              <th className="px-3 py-2">Seguridad</th>
              <th className="px-3 py-2">MOQ</th>
              <th className="px-3 py-2">Multiplo</th>
              <th className="px-3 py-2">Stats</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {products.map((product) => {
              const stats = statsByProduct.get(product.id);
              return (
                <tr key={product.id} className="align-top">
                  <td className="px-3 py-2">
                    <input value={product.name} onChange={(e) => patchProduct(product.id, { name: e.target.value })} className="w-36 rounded-lg border border-slate-200 px-2 py-1.5" />
                  </td>
                  <td className="px-3 py-2">
                    <input value={product.country} onChange={(e) => patchProduct(product.id, { country: e.target.value.toUpperCase() })} className="w-16 rounded-lg border border-slate-200 px-2 py-1.5" />
                  </td>
                  <NumberCell value={product.stock} onChange={(v) => updateNumber<ProductInput>(v, "stock", (p) => patchProduct(product.id, p))} />
                  <NumberCell value={product.leadTimeDays} suffix="d" onChange={(v) => updateNumber<ProductInput>(v, "leadTimeDays", (p) => patchProduct(product.id, p))} />
                  <NumberCell value={product.unitCost} onChange={(v) => updateNumber<ProductInput>(v, "unitCost", (p) => patchProduct(product.id, p))} />
                  <NumberCell value={product.logisticsCost} onChange={(v) => updateNumber<ProductInput>(v, "logisticsCost", (p) => patchProduct(product.id, p))} />
                  <NumberCell value={product.amazonFee} onChange={(v) => updateNumber<ProductInput>(v, "amazonFee", (p) => patchProduct(product.id, p))} />
                  <NumberCell value={product.minMarginPct} suffix="%" onChange={(v) => updateNumber<ProductInput>(v, "minMarginPct", (p) => patchProduct(product.id, p))} />
                  <NumberCell value={product.capturePct} suffix="%" onChange={(v) => updateNumber<ProductInput>(v, "capturePct", (p) => patchProduct(product.id, p))} />
                  <NumberCell value={product.safetyDays} suffix="d" onChange={(v) => updateNumber<ProductInput>(v, "safetyDays", (p) => patchProduct(product.id, p))} />
                  <NumberCell value={product.moq} onChange={(v) => updateNumber<ProductInput>(v, "moq", (p) => patchProduct(product.id, p))} />
                  <NumberCell value={product.cartonMultiple} onChange={(v) => updateNumber<ProductInput>(v, "cartonMultiple", (p) => patchProduct(product.id, p))} />
                  <td className="px-3 py-2 text-xs text-slate-600">
                    Media {fmtNum(stats?.meanUnits)} | Moda {fmtNum(stats?.modalUnits)} | Precio {fmtMoney(stats?.modalPrice)}
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => removeProduct(product.id)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Eliminar producto">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CompetitorTable({
  products,
  competitors,
  patchCompetitor,
  removeCompetitor,
  addCompetitor,
}: {
  products: ProductInput[];
  competitors: CompetitorInput[];
  patchCompetitor: (id: string, patch: Partial<CompetitorInput>) => void;
  removeCompetitor: (id: string) => void;
  addCompetitor: () => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Competidores</h2>
          <p className="mt-1 text-sm text-slate-600">Cada fila debe coincidir con producto y pais.</p>
        </div>
        <button type="button" onClick={addCompetitor} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <Plus className="h-4 w-4" />
          Competidor
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Pais</th>
              <th className="px-3 py-2">ASIN</th>
              <th className="px-3 py-2">Titulo</th>
              <th className="px-3 py-2">Precio</th>
              <th className="px-3 py-2">Uds/mes</th>
              <th className="px-3 py-2">Revenue</th>
              <th className="px-3 py-2">BSR</th>
              <th className="px-3 py-2">Reviews</th>
              <th className="px-3 py-2">Rating</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {competitors.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2">
                  <select value={row.productId} onChange={(e) => patchCompetitor(row.id, { productId: e.target.value })} className="w-40 rounded-lg border border-slate-200 px-2 py-1.5">
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input value={row.country} onChange={(e) => patchCompetitor(row.id, { country: e.target.value.toUpperCase() })} className="w-16 rounded-lg border border-slate-200 px-2 py-1.5" />
                </td>
                <td className="px-3 py-2">
                  <input value={row.asin} onChange={(e) => patchCompetitor(row.id, { asin: e.target.value })} className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 font-mono text-xs" />
                </td>
                <td className="px-3 py-2">
                  <input value={row.title} onChange={(e) => patchCompetitor(row.id, { title: e.target.value })} className="w-40 rounded-lg border border-slate-200 px-2 py-1.5" />
                </td>
                <NumberCell value={row.price} onChange={(v) => updateNumber<CompetitorInput>(v, "price", (p) => patchCompetitor(row.id, p))} />
                <NumberCell value={row.monthlyUnits} onChange={(v) => updateNumber<CompetitorInput>(v, "monthlyUnits", (p) => patchCompetitor(row.id, p))} />
                <NumberCell value={row.revenue} onChange={(v) => updateNumber<CompetitorInput>(v, "revenue", (p) => patchCompetitor(row.id, p))} />
                <NumberCell value={row.bsr} onChange={(v) => updateNumber<CompetitorInput>(v, "bsr", (p) => patchCompetitor(row.id, p))} />
                <NumberCell value={row.reviews} onChange={(v) => updateNumber<CompetitorInput>(v, "reviews", (p) => patchCompetitor(row.id, p))} />
                <NumberCell value={row.rating} onChange={(v) => updateNumber<CompetitorInput>(v, "rating", (p) => patchCompetitor(row.id, p))} />
                <td className="px-3 py-2">
                  <button type="button" onClick={() => removeCompetitor(row.id)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Eliminar competidor">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlanTable({ plan }: { plan: MonthlyPlanLine[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Plan mensual anual</h2>
          <p className="mt-1 text-sm text-slate-600">
            Compra sugerida por mes, con llegada desplazada por lead time. La moda se calcula por bandas de 50 uds y 1 EUR.
          </p>
        </div>
        <button type="button" onClick={() => downloadCsv(plan)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <Download className="h-4 w-4" />
          Exportar plan
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[1040px] w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Pais</th>
              <th className="px-3 py-2">Mes</th>
              <th className="px-3 py-2">Forecast media</th>
              <th className="px-3 py-2">Forecast moda</th>
              <th className="px-3 py-2">Comprar</th>
              <th className="px-3 py-2">Llegada</th>
              <th className="px-3 py-2">Stock inicio</th>
              <th className="px-3 py-2">Stock fin</th>
              <th className="px-3 py-2">Precio objetivo</th>
              <th className="px-3 py-2">Precio min.</th>
              <th className="px-3 py-2">Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {plan.map((line) => (
              <tr key={`${line.product.id}-${line.monthIndex}`} className={line.orderUnits > 0 ? "bg-blue-50/40" : undefined}>
                <td className="px-3 py-2 font-medium text-slate-900">{line.product.name}</td>
                <td className="px-3 py-2">{line.product.country}</td>
                <td className="px-3 py-2">{line.monthLabel}</td>
                <td className="px-3 py-2">{fmtNum(line.forecastUnits)} uds</td>
                <td className="px-3 py-2">{fmtNum(line.modalForecastUnits)} uds</td>
                <td className="px-3 py-2 font-semibold text-blue-700">{fmtNum(line.orderUnits)} uds</td>
                <td className="px-3 py-2">{line.arrivalMonthLabel}</td>
                <td className="px-3 py-2">{fmtNum(line.openingStock)}</td>
                <td className="px-3 py-2">{fmtNum(line.closingStock)}</td>
                <td className="px-3 py-2">{fmtMoney(line.targetPrice)}</td>
                <td className="px-3 py-2">{fmtMoney(line.minProfitablePrice)}</td>
                <td className="px-3 py-2">{fmtMoney(line.expectedRevenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NumberCell({ value, onChange, suffix }: { value: number; onChange: (value: string) => void; suffix?: string }) {
  return (
    <td className="px-3 py-2">
      <div className="flex w-24 items-center rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
        <input type="number" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none" />
        {suffix ? <span className="ml-1 text-xs text-slate-500">{suffix}</span> : null}
      </div>
    </td>
  );
}

function KpiCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
        </div>
      </div>
    </div>
  );
}
