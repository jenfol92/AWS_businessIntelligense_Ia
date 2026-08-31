import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";

const repoRoot = process.cwd();
const nodeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function resolveModule(specifier, parentFile) {
  if (specifier.startsWith("@/")) return path.join(repoRoot, specifier.slice(2));
  if (specifier.startsWith(".")) return path.resolve(path.dirname(parentFile), specifier);
  return specifier;
}

function resolveFile(specifier, parentFile) {
  const resolved = resolveModule(specifier, parentFile);
  if (!path.isAbsolute(resolved)) return resolved;
  for (const candidate of [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return resolved;
}

function requireTs(specifier, parentFile = path.join(repoRoot, "scripts", "root.cjs")) {
  const filePath = resolveFile(specifier, parentFile);
  if (!path.isAbsolute(filePath)) return nodeRequire(filePath);
  if (moduleCache.has(filePath)) return moduleCache.get(filePath).exports;
  const source = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
  const module = { exports: {} };
  moduleCache.set(filePath, module);
  new Function("require", "module", "exports", "__filename", "__dirname", output)(
    (child) => requireTs(child, filePath),
    module,
    module.exports,
    filePath,
    path.dirname(filePath),
  );
  return module.exports;
}

function mockModule(relativePath, exports) {
  const filePath = resolveFile(path.join(repoRoot, relativePath), path.join(repoRoot, "root.cjs"));
  moduleCache.set(filePath, { exports });
}

const calls = { rpc: [], traces: [], costPreview: 0 };
let containerType = "propio";
let destinations = [];
const orderItems = [
  {
    id: "item-1",
    orden_id: "order-1",
    producto_id: "product-1",
    cantidad: 10,
    cbm_unitario: 1,
    cbm_total: 10,
    coste_unitario_eur: 5,
    lote_producto: "lot-1",
  },
];

mockModule("modules/containers/repositories/containerStockRepository.ts", {
  countActiveStockApplied: async () => 0,
  countProductoCostosForContainer: async () => 0,
  countStockDestinos: async () => destinations.length,
  callFnStockAdd: async (input) => calls.rpc.push(input),
  fetchAmazonEnviosForContainer: async () => [],
  fetchContainerForStock: async () => ({
    id: "container-1",
    tipo_contenedor: containerType,
  }),
  fetchOrderItemsForContainer: async () => orderItems,
  fetchStockDestinosForContainer: async () => destinations,
  insertStockAplicadoRows: async (rows) => calls.traces.push(...rows),
});
mockModule("modules/containers/services/calculateContainerCbmCostAllocation.ts", {
  calculateContainerCbmCostAllocation: async () => {
    calls.costPreview += 1;
    return { cbmTotalContenedor: 10, lineas: [] };
  },
});

const { applyContainerStock } = requireTs(
  "../modules/containers/services/applyContainerStock.ts",
);

const fbmDestination = {
  id: "destination-fbm",
  contenedor_id: "container-1",
  orden_item_id: "item-1",
  producto_id: "product-1",
  pais: "ES",
  canal: "FBM",
  marketplace_id: null,
  cantidad: 10,
  notas: null,
};

destinations = [fbmDestination];
const fbmResult = await applyContainerStock("container-1", { includeCostPreview: true });
assert.equal(fbmResult.applied, false);
assert.equal(fbmResult.reason, "fbm_stock_managed_by_amazon");
assert.equal(calls.rpc.length, 0, "FBM must not invoke fn_stock_add");
assert.equal(calls.traces.length, 0, "FBM skip must not claim stock was applied");
assert.equal(calls.costPreview, 1, "available_stock transition keeps cost preview");

destinations = [{ ...fbmDestination, id: "destination-fba", canal: "FBA" }];
const fbaResult = await applyContainerStock("container-1");
assert.equal(fbaResult.applied, true);
assert.equal(fbaResult.summary.linesApplied, 1);
assert.equal(calls.rpc.length, 1);
assert.equal(calls.rpc[0].canal, "FBA");
assert.equal(calls.traces.length, 1);
assert.equal(calls.traces[0].canal, "FBA");

containerType = "agl";
const aglResult = await applyContainerStock("container-1");
assert.equal(aglResult.applied, false);
assert.equal(aglResult.reason, "agl_stock_managed_by_amazon");
assert.equal(calls.rpc.length, 1, "AGL must not add stock");

moduleCache.clear();
const { calculateCbmCostAllocationFromData } = requireTs(
  "../modules/containers/services/calculateContainerCbmCostAllocation.ts",
);
const allocation = calculateCbmCostAllocationFromData({
  container: {
    costo_flete_total_eur: 100,
    gastos_llegada_puerto_eur: 50,
    costo_transito_total_eur: 25,
    comision_bancaria_eur: 10,
    flete: null,
    gastos_llegada_puerto: null,
  },
  orderItems,
});
assert.equal(allocation.cbmTotalContenedor, 10);
assert.deepEqual(allocation.lineas[0], {
  ordenItemId: "item-1",
  productoId: "product-1",
  cantidad: 10,
  cbmTotal: 10,
  costeFleteUnitario: 10,
  costePuertoUnitario: 5,
  costeTransitoUnitario: 2.5,
  costeBancoUnitario: 1,
  costeLogisticoUnitarioTotal: 18.5,
});

moduleCache.clear();
const savedCostPayloads = [];
mockModule("modules/containers/utils/resolveContainerEstados.ts", {
  syncLegacyEstadoFromSeparated: () => "facturado",
});
mockModule("modules/containers/services/calculateContainerCbmCostAllocation.ts", {
  calculateCbmCostAllocationFromData: () => allocation,
});
mockModule("modules/containers/services/validateContainerFacturacion.ts", {
  costosDedupKey: (productId, lot) => `${productId}:${lot}`,
  resolveContainerLogisticTotals: () => ({
    costeFleteTotal: 100,
    costeTransitoTotal: 25,
    gastosLlegadaTotal: 50,
    costeTotalLogistico: 175,
  }),
  resolveLoteProductoForCostos: (item) => item.lote_producto,
  validateContainerFacturacion: () => ({ ok: true, warnings: [] }),
});
mockModule("modules/containers/repositories/containerBillingRepository.ts", {
  fetchContainerForBilling: async () => ({
    id: "container-1",
    identificador_embarque: "C-1",
    tipo_contenedor: "propio",
    estado: "disponible_stock",
    estado_logistico: "entregado",
    estado_stock: "disponible_stock",
    costo_flete_total_eur: 100,
    gastos_llegada_puerto_eur: 50,
    costo_transito_total_eur: 25,
    comision_bancaria_eur: 10,
    flete: null,
    gastos_llegada_puerto: null,
    puerto_llegada: "ES",
  }),
  fetchExistingProductoCostosForContainer: async () => new Map(),
  fetchOrderItemsForBilling: async () => [{
    ...orderItems[0],
    proveedor_id: "supplier-1",
    coste_unitario_moneda: 6,
    moneda_compra: "USD",
    tipo_cambio_moneda_eur: 0.9,
    sku: "SKU-1",
    nombre: "Product 1",
    destino: "ES",
  }],
  markContainerCostesFacturados: async () => {},
  upsertProductoCostoFromFacturacion: async (_id, payload) => {
    savedCostPayloads.push(payload);
    return { id: "cost-1", action: "inserted" };
  },
});
const { facturarContainerCosts } = requireTs(
  "../modules/containers/services/facturarContainerCosts.ts",
);
const billingResult = await facturarContainerCosts("container-1", "user-1");
assert.equal(billingResult.ok, true);
assert.equal(billingResult.producto_costos_upserted, 1);
assert.equal(savedCostPayloads.length, 1);
assert.equal(savedCostPayloads[0].costo_flete_unit_eur, 10);
assert.equal(savedCostPayloads[0].gastos_llegada_puerto_eur_unit, 5);
assert.equal(savedCostPayloads[0].transito_eur_unit, 2.5);

const billingSource = fs.readFileSync(
  path.join(repoRoot, "modules/containers/services/facturarContainerCosts.ts"),
  "utf8",
);
assert.match(billingSource, /calculateCbmCostAllocationFromData/);
assert.match(billingSource, /upsertProductoCostoFromFacturacion/);
assert.match(billingSource, /costo_flete_unit_eur/);
assert.match(billingSource, /gastos_llegada_puerto_eur_unit/);
assert.match(billingSource, /transito_eur_unit/);

console.log("PASS container FBM external owner, FBA, AGL, cost preview, billing contract and CBM allocation");
