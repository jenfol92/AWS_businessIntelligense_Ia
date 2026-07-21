import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildConfirmedOperationsPatch } from "../modules/orders/utils/buildConfirmedOperationsPatch.ts";
import {
  loadProformaData,
  prepareProformaVersion,
  renderProformaHtml,
} from "../modules/orders/services/orderProformaData.ts";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const rpcSql = read("sql/migrations/20260721_remove_order_fx_from_operational_flow.sql");
const versionSql = read("sql/migrations/20260721_safe_order_proforma_versioning.sql");
const cleanupSql = read("sql/migrations/20260721_remove_confirmed_commercial_edit_rpc.sql");
const operationsRoute = read("app/api/orders/[id]/confirmed-operations/route.ts");
const operationsService = read(
  "modules/orders/services/updateConfirmedOrderOperationsService.ts",
);
const proformaRoute = read("app/api/orders/[id]/proforma/route.ts");
const proformaService = read("modules/orders/services/orderProformaData.ts");
const modal = read("modules/orders/components/OrderFormModal.tsx");
const ordersPage = read("app/[locale]/(dashboard)/pedidos/page.tsx");
const diagnosticSql = read("sql/diagnostics/confirmed_order_operations_validation.sql");
const confirmModal = read("modules/orders/components/ConfirmOrderModal.tsx");
const confirmRoute = read("app/api/orders/[id]/confirm/route.ts");
const confirmRepository = read("modules/orders/repositories/orderConfirmRepository.ts");
const itemPersistence = read(
  "modules/orders/services/prepareOrderItemsForPersistence.ts",
);
const factoryCostMapper = read(
  "modules/orders/utils/mapFactoryCostToOrderItem.ts",
);

assert.doesNotMatch(operationsRoute, /\bitems\b|orden_items|producto_costos/);
assert.doesNotMatch(operationsService, /\bitems\b|orden_items|producto_costos/);
assert.doesNotMatch(
  operationsService,
  /tipo_cambio_moneda_eur|tipo_cambio_usd_eur/,
);

const paymentBlock = rpcSql.slice(rpcSql.indexOf("IF v_changed_schedule"));
assert.match(
  paymentBlock,
  /payment_type = 'BALANCE_70'[\s\S]*status IN \('pendiente', 'vencido'\)/,
);
assert.doesNotMatch(paymentBlock, /DEPOSITO_30|amount_original\s*=|producto_costos/);
assert.match(
  paymentBlock,
  /amazon_agl' THEN v_updated\.etd::date/,
);
assert.match(
  paymentBlock,
  /v_balance_due < CURRENT_DATE THEN 'vencido'[\s\S]*ELSE 'pendiente'/,
);

// logistics_type debe sincronizarse en TODOS los pagos no realizados (igual que
// syncSupplierPaymentsForOrder, que fija el mismo valor en DEPOSITO_30 y BALANCE_70),
// mientras que due_date/status siguen limitados a BALANCE_70.
const dueDateUpdate = paymentBlock.match(
  /UPDATE public\.finance_supplier_payments fsp\s+SET\s+due_date[\s\S]*?status IN \('pendiente', 'vencido'\);/,
)?.[0] ?? "";
assert.ok(dueDateUpdate, "debe existir el UPDATE de due_date/status");
assert.match(dueDateUpdate, /payment_type = 'BALANCE_70'/);
assert.doesNotMatch(dueDateUpdate, /logistics_type/);

const logisticsUpdate = paymentBlock.match(
  /IF v_changed_shipping THEN\s+UPDATE public\.finance_supplier_payments fsp\s+SET\s+logistics_type[\s\S]*?status IN \('pendiente', 'vencido'\);/,
)?.[0] ?? "";
assert.ok(logisticsUpdate, "debe existir el UPDATE de logistics_type");
assert.doesNotMatch(
  logisticsUpdate,
  /payment_type = 'BALANCE_70'/,
  "logistics_type debe actualizarse en DEPOSITO_30 y BALANCE_70, no solo en BALANCE_70",
);

// agente_id inválido debe rechazarse con un mensaje entendible (no un error crudo de cast).
assert.match(rpcSql, /agente_id debe ser un UUID válido/);
assert.match(
  rpcSql,
  /agente_id[\s\S]{0,200}!~\*\s*\n?\s*'\^\[0-9a-f\]\{8\}/,
);

const destinationUpdate = rpcSql.match(
  /UPDATE public\.ordenes_compra oc[\s\S]*?RETURNING \* INTO v_updated;/,
)?.[0] ?? "";
assert.ok(destinationUpdate);
assert.doesNotMatch(destinationUpdate, /orden_items|producto_costos|finance_supplier_payments|order_proforma_versions/);

for (const forbidden of [
  "Exchange Rate to EUR",
  "Unit Price (EUR)",
  "Line Total (EUR)",
  "Equivalent Total EUR",
  "Deposit (EUR)",
  "Balance (EUR)",
  "Exchange rate pending",
]) {
    assert.doesNotMatch(
      `${proformaRoute}\n${proformaService}`,
      new RegExp(forbidden.replace(/[()]/g, "\\$&")),
    );
}
for (const removedName of [
  "tipoCambio",
  "sinTipoCambio",
  "showEurCols",
  "eurHeaderCols",
  "eurFootCols",
  "eurTotalBlock",
  "eurPaymentBlock",
  "cambioLabel",
  "avisoCambio",
]) {
  assert.doesNotMatch(
    `${proformaRoute}\n${proformaService}`,
    new RegExp(`\\b${removedName}\\b`),
  );
}

const confirmedSave = modal.slice(
  modal.indexOf("if (isConfirmedEdit && initialOrden?.id)"),
  modal.indexOf("const body1 ="),
);
assert.match(confirmedSave, /setSavedOrder\(updatedOrder\)/);
assert.match(confirmedSave, /setSuccessMessage\("Cambios guardados correctamente"\)/);
assert.match(confirmedSave, /onOperationalSaved\?\.\(updatedOrder\)/);
assert.doesNotMatch(confirmedSave, /window\.open|onSaved\(/);
assert.match(
  ordersPage,
  /onOperationalSaved=\{\(orden\) => \{[\s\S]*ordersList\.patchOrder\(/,
);

assert.equal(
  existsSync(join(root, "app/api/orders/[id]/confirmed-edit/route.ts")),
  false,
);
assert.equal(
  existsSync(join(root, "modules/orders/services/updateConfirmedOrderService.ts")),
  false,
);
assert.match(
  cleanupSql,
  /DROP FUNCTION IF EXISTS public\.update_confirmed_purchase_order\(uuid, jsonb, jsonb\)/,
);

assert.match(rpcSql, /lead_time_produccion debe ser un entero mayor o igual que cero/);
assert.match(rpcSql, /lead_time_transito debe ser un entero mayor o igual que cero/);
assert.match(rpcSql, /tipo_envio debe ser propio o amazon_agl/);
assert.match(rpcSql, /La edición operativa contiene campos no permitidos/);
assert.doesNotMatch(rpcSql, /tipo_cambio_moneda_eur|planned_fx_rate|amount_eur|coste_total_eur|v_changed_fx|orden_items/);

assert.match(
  versionSql,
  /FROM public\.ordenes_compra[\s\S]*FOR UPDATE[\s\S]*max\(opv\.version\)[\s\S]*INSERT INTO public\.order_proforma_versions/,
);
assert.match(
  proformaRoute,
  /\.rpc\(\s*"create_order_proforma_version"/,
);
assert.doesNotMatch(
  proformaRoute,
  /\.from\("order_proforma_versions"\)\s*\.insert/,
);
assert.match(proformaRoute, /\.from\("ordenes_compra"\)[\s\S]*?\.select\("\*"\)/);
assert.doesNotMatch(
  `${rpcSql}\n${versionSql}\n${proformaRoute}\n${proformaService}`,
  /(?:update|set)\s+proforma_firmada_url/i,
);

// GET sin versión explícita y sin ninguna versión persistida debe renderizar el
// estado actual (comportamiento aceptado: ConfirmOrderModal abre esta misma ruta
// antes de que exista ninguna versión guardada).
const getHandler = proformaRoute.slice(
  proformaRoute.indexOf("export async function GET"),
  proformaRoute.indexOf("export async function POST"),
);
assert.match(getHandler, /loadProformaData\(/);
assert.match(getHandler, /renderProformaHtml\(loaded\.data, params\.id\)/);
assert.match(
  getHandler,
  /if \(requestedVersion\) \{[\s\S]*?La versión solicitada no existe/,
  "una versión explícita inexistente debe seguir devolviendo error",
);

// El coste comercial debe tener fallback también para órdenes EUR antiguas sin
// coste_unitario_moneda (no solo USD); GBP/CNY no tuvieron nunca columna propia.
assert.match(proformaService, /legacyEurCost/);
assert.match(
  proformaService,
  /currency === "EUR"\) return legacyEurCost/,
);

// El REVOKE de la RPC comercial antigua no debe fallar si la función no existe
// en el entorno (bases que no aplicaron 20260720 todavía).
assert.match(cleanupSql, /DO \$\$/);
assert.match(cleanupSql, /IF EXISTS \(/);
assert.match(cleanupSql, /FROM pg_proc/);

// ── ISSUE_1: buildConfirmedOperationsPatch envía únicamente lo modificado ──

const BASELINE = {
  destino: "Puerto A",
  tipo_envio: "propio",
  etd: null,
  eta: "2026-08-01",
  eta_real: null,
  lead_time_produccion: 30,
  lead_time_transito: 15,
  agente_id: "11111111-1111-1111-1111-111111111111",
  numero_pedido_agente: "PO-1",
  notas: "nota base",
};

// Cambiar solo destino envía exactamente { destino: ... }.
assert.deepEqual(
  buildConfirmedOperationsPatch({ ...BASELINE, destino: "Puerto B" }, BASELINE),
  { destino: "Puerto B" },
);

// Cambiar solo ETA envía exactamente { eta: ... }.
assert.deepEqual(
  buildConfirmedOperationsPatch({ ...BASELINE, eta: "2026-09-15" }, BASELINE),
  { eta: "2026-09-15" },
);

// Limpiar ETA envía { eta: null }.
assert.deepEqual(
  buildConfirmedOperationsPatch({ ...BASELINE, eta: null }, BASELINE),
  { eta: null },
);
assert.deepEqual(
  buildConfirmedOperationsPatch({ ...BASELINE, eta: "" }, BASELINE),
  { eta: null },
);

// Sin cambios: patch vacío (segundo guardado no debe disparar PATCH).
assert.deepEqual(buildConfirmedOperationsPatch({ ...BASELINE }, BASELINE), {});
assert.deepEqual(
  buildConfirmedOperationsPatch(
    { ...BASELINE, etd: "" , eta_real: "", notas: "", agente_id: "", numero_pedido_agente: "" },
    { ...BASELINE, etd: null, eta_real: null, notas: null, agente_id: null, numero_pedido_agente: null },
  ),
  {},
  "campos ya nulos en baseline pero vacíos en el formulario no deben generar patch",
);

// La fecha se compara solo por YYYY-MM-DD, ignorando hora/zona si llegara con ella.
assert.deepEqual(
  buildConfirmedOperationsPatch(
    { ...BASELINE, eta: "2026-08-01T00:00:00.000Z" },
    BASELINE,
  ),
  {},
  "misma fecha con sufijo horario no debe generar patch",
);

// Los números se comparan como number o null, no como string.
assert.deepEqual(
  buildConfirmedOperationsPatch(
    { ...BASELINE, lead_time_produccion: 45 },
    BASELINE,
  ),
  { lead_time_produccion: 45 },
);
assert.deepEqual(
  buildConfirmedOperationsPatch(
    { ...BASELINE, lead_time_transito: null },
    BASELINE,
  ),
  { lead_time_transito: null },
);

// Nunca debe incluir items, costes ni campos comerciales: el tipo devuelto solo
// puede contener claves operativas conocidas.
const ALLOWED_PATCH_KEYS = new Set([
  "destino",
  "tipo_envio",
  "etd",
  "eta",
  "eta_real",
  "lead_time_produccion",
  "lead_time_transito",
  "agente_id",
  "numero_pedido_agente",
  "notas",
]);
const fullyChangedPatch = buildConfirmedOperationsPatch(
  {
    destino: "Puerto C",
    tipo_envio: "amazon_agl",
    etd: "2026-10-01",
    eta: "2026-10-20",
    eta_real: "2026-10-22",
    lead_time_produccion: 40,
    lead_time_transito: 20,
    agente_id: "22222222-2222-2222-2222-222222222222",
    numero_pedido_agente: "PO-2",
    notas: "otra nota",
  },
  BASELINE,
);
for (const key of Object.keys(fullyChangedPatch)) {
  assert.ok(ALLOWED_PATCH_KEYS.has(key), `clave no permitida en el patch: ${key}`);
}

// "Datos no modificados no pueden sobrescribir cambios concurrentes": el patch
// construido contra la línea base local nunca incluye una clave que el usuario
// no tocó, así que una actualización concurrente de otro campo en el servidor
// no puede ser pisada por este guardado.
const concurrentSafePatch = buildConfirmedOperationsPatch(
  { ...BASELINE, notas: "nota editada por este usuario" },
  BASELINE,
);
assert.deepEqual(concurrentSafePatch, { notas: "nota editada por este usuario" });
assert.ok(
  !("agente_id" in concurrentSafePatch) && !("eta" in concurrentSafePatch),
  "campos no tocados por el usuario no deben viajar en el patch",
);

// Confirmar USD, CNY o EUR no pide ni envía un tipo de cambio de orden.
for (const currency of ["USD", "CNY", "EUR"]) {
  assert.match(confirmModal, new RegExp(`\\{ code: "${currency}"`));
}
assert.doesNotMatch(confirmModal, /tipo_cambio_moneda_eur|tipo_cambio_usd_eur|1 \{moneda\} = EUR/);
assert.doesNotMatch(confirmRoute, /tipo_cambio_moneda_eur|tipo_cambio_usd_eur/);
assert.match(
  confirmRepository,
  /p_tipo_cambio_moneda_eur:\s*null[\s\S]*p_tipo_cambio_usd_eur:\s*null/,
);
assert.doesNotMatch(modal, /tipoCambio|setTipoCambio|tipo_cambio_moneda_eur:/);
assert.doesNotMatch(
  itemPersistence,
  /tipo_cambio_moneda_eur|tipo_cambio_usd_eur|orderTipoCambio/,
);
assert.doesNotMatch(factoryCostMapper, /orderTipoCambio/);

// El modal debe usar el helper y mantener una línea base operativa que se
// actualiza tras cada guardado con la orden devuelta por el servidor.
assert.match(
  modal,
  /import\s*\{\s*\n?\s*buildConfirmedOperationsPatch,[\s\S]*?\}\s*from\s*"@\/modules\/orders\/utils\/buildConfirmedOperationsPatch"/,
);
assert.match(modal, /operationalBaseline/);
assert.match(modal, /const operationsPatch = buildConfirmedOperationsPatch\(/);
assert.match(
  modal,
  /if \(Object\.keys\(operationsPatch\)\.length === 0\) \{\s*setSuccessMessage\("No hay cambios pendientes"\);\s*return;\s*\}/,
);
assert.match(modal, /setOperationalBaseline\(mapOrdenRowToOperationsFields\(updatedOrder\)\)/);
// El "no hay cambios pendientes" nunca debe marcarse como error.
const noChangesGuard = modal.slice(
  modal.indexOf('setSuccessMessage("No hay cambios pendientes")') - 200,
  modal.indexOf('setSuccessMessage("No hay cambios pendientes")') + 60,
);
assert.doesNotMatch(noChangesGuard, /setError\(/);

// ── Proforma: pruebas funcionales de carga, validación e HTML ─────────────

const TEST_ORDER = {
  id: "order-1",
  numero_orden: "PO-TEST",
  moneda_compra: "USD",
  deposito_porcentaje: 30,
  proforma_firmada_url: null,
};

function itemWithCost(cost, sku = "SKU-1", quantity = 2) {
  return {
    cantidad: quantity,
    coste_unitario_moneda: cost,
    coste_unitario_usd: null,
    coste_unitario_eur: null,
    cbm_total: 1,
    productos: { sku, nombre: `Producto ${sku}`, producto_detalle: null },
    proveedores: { nombre: "Proveedor" },
    lote_producto: null,
  };
}

function sourceFixture({ order = TEST_ORDER, items = [], orderError = null, itemsError = null } = {}) {
  const calls = { order: 0, items: 0 };
  return {
    calls,
    source: {
      async getOrder() {
        calls.order += 1;
        return { data: order, error: orderError };
      },
      async getItems() {
        calls.items += 1;
        return { data: items, error: itemsError };
      },
    },
  };
}

// Un error consultando líneas se conserva como error controlado; nunca pasa a [].
{
  const fixture = sourceFixture({
    itemsError: { message: "fallo simulado de orden_items" },
  });
  const result = await loadProformaData(fixture.source, "order-1");
  assert.deepEqual(result, {
    ok: false,
    status: 500,
    code: "PROFORMA_DATA_QUERY_FAILED",
    error:
      "No se pudieron consultar las líneas de la proforma: fallo simulado de orden_items",
  });
  assert.deepEqual(fixture.calls, { order: 1, items: 1 });
}

// La orden sin líneas se rechaza antes de que pueda existir HTML versionable.
{
  const fixture = sourceFixture({ items: [] });
  const result = await prepareProformaVersion(fixture.source, "order-1");
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.equal(result.code, "EMPTY_ORDER_ITEMS");
  assert.deepEqual(fixture.calls, { order: 1, items: 1 });
}

// Null, cero, negativo y valores no finitos son costes inválidos. GET puede
// renderizarlos como pendientes; la preparación de POST nunca queda `ok`.
for (const [cost, sku] of [
  [null, "SKU-NULL"],
  [0, "SKU-ZERO"],
  [-3, "SKU-NEG"],
  ["NaN", "SKU-NAN"],
  ["Infinity", "SKU-INF"],
]) {
  const fixture = sourceFixture({ items: [itemWithCost(cost, sku)] });
  const loaded = await loadProformaData(fixture.source, "order-1");
  assert.equal(loaded.ok, true);
  assert.equal(loaded.data.hasInvalidCommercialCosts, true);
  assert.deepEqual(loaded.data.invalidCostSkus, [sku]);

  const previewHtml = renderProformaHtml(loaded.data, "order-1");
  assert.match(previewHtml, /Coste pendiente/);
  assert.match(previewHtml, new RegExp(sku));
  assert.doesNotMatch(previewHtml, /Total USD<\/label><span>\$0\.00/);

  const postFixture = sourceFixture({ items: [itemWithCost(cost, sku)] });
  const prepared = await prepareProformaVersion(postFixture.source, "order-1");
  assert.equal(prepared.ok, false);
  assert.equal(prepared.status, 422);
  assert.equal(prepared.code, "MISSING_COMMERCIAL_COSTS");
}

// Un total no finito también invalida la línea aunque el unitario sea positivo.
{
  const fixture = sourceFixture({
    items: [itemWithCost(Number.MAX_VALUE, "SKU-OVERFLOW", Number.MAX_VALUE)],
  });
  const result = await loadProformaData(fixture.source, "order-1");
  assert.equal(result.ok, true);
  assert.equal(result.data.hasInvalidCommercialCosts, true);
  assert.deepEqual(result.data.invalidCostSkus, ["SKU-OVERFLOW"]);
}

// POST carga orden y líneas exactamente una vez; el HTML persistible deriva de
// esa misma instantánea validada, sin una segunda consulta.
{
  const items = [itemWithCost(10, "SKU-SNAPSHOT")];
  const fixture = sourceFixture({ items });
  const prepared = await prepareProformaVersion(fixture.source, "order-1");
  assert.equal(prepared.ok, true);
  assert.deepEqual(fixture.calls, { order: 1, items: 1 });
  assert.equal(prepared.data.rows[0].unitMoneda, 10);
  assert.match(prepared.htmlContent, /SKU-SNAPSHOT/);
  assert.match(prepared.htmlContent, /\$10\.00/);
  assert.match(prepared.htmlContent, /\$20\.00/);
  items[0].coste_unitario_moneda = 999;
  assert.doesNotMatch(prepared.htmlContent, /\$999\.00/);
}

// El handler POST usa el preparador una sola vez y entrega exactamente su HTML
// a la RPC; los resultados 422/500 retornan antes de esa llamada.
const postHandler = proformaRoute.slice(
  proformaRoute.indexOf("export async function POST"),
);
assert.equal(
  (postHandler.match(/prepareProformaVersion\(/g) ?? []).length,
  1,
);
assert.doesNotMatch(postHandler, /loadProformaData\(/);
assert.match(postHandler, /p_html_content: prepared\.htmlContent/);
assert.match(proformaService, /code: "EMPTY_ORDER_ITEMS"/);
assert.match(proformaService, /code: "MISSING_COMMERCIAL_COSTS"/);

// ── ISSUE_3: el script de validación evita falsos positivos en negativos ──

assert.match(
  diagnosticSql,
  /CREATE TEMP TABLE _confirmed_order_test_context \(\s*order_id uuid NOT NULL\s*\) ON COMMIT DROP;/,
);
assert.match(
  diagnosticSql,
  /INSERT INTO _confirmed_order_test_context\(order_id\)\s*VALUES \(:'test_order_id'::uuid\);/,
);
// Ningún DO $$ posterior debe volver a interpolar :'test_order_id'.
const afterContextInsert = diagnosticSql.slice(
  diagnosticSql.indexOf("INSERT INTO _confirmed_order_test_context"),
);
assert.doesNotMatch(afterContextInsert.slice(afterContextInsert.indexOf("DO $$")), /:'test_order_id'/);

// Fixtures explícitos que abortan con mensaje claro si faltan.
for (const fixtureCheck of [
  "no existe",
  "no está confirmada",
  "BALANCE_70 pendiente o vencido",
  "no tiene DEPOSITO_30",
  "ningún pago pagado",
  "asignación logística activa",
]) {
  assert.match(diagnosticSql, new RegExp(`FIXTURE_FALTANTE[\\s\\S]{0,120}${fixtureCheck}`));
}

// Snapshots reales usados por los asserts (no solo SELECT visuales).
assert.match(diagnosticSql, /CREATE TEMP TABLE _snapshot_ordenes_compra ON COMMIT DROP AS/);
assert.match(diagnosticSql, /CREATE TEMP TABLE _snapshot_finance_supplier_payments ON COMMIT DROP AS/);
assert.match(diagnosticSql, /CREATE TEMP TABLE _snapshot_order_proforma_versions ON COMMIT DROP AS/);

// Los negativos deben capturar SQLSTATE específicos, nunca WHEN OTHERS, y el
// RAISE de fallo del test debe vivir fuera del bloque que atrapa la excepción
// de la RPC (si no, un "test_FALLO" propio podría auto-declararse "ok").
assert.doesNotMatch(diagnosticSql, /EXCEPTION WHEN OTHERS THEN\s*RAISE NOTICE '.*_ok/);
const negativeTestMarkers = [
  ["test_9", "-- 9) Lead time negativo rechazado", "22023"],
  ["test_10", "-- 10) Fecha inválida rechazada", "22007"],
  ["test_11", "-- 11) Campo no permitido rechazado", "22023"],
];
for (let i = 0; i < negativeTestMarkers.length; i += 1) {
  const [testName, marker, sqlstate] = negativeTestMarkers[i];
  const start = diagnosticSql.indexOf(marker);
  assert.ok(start >= 0, `no se encontró el bloque ${testName}`);
  const nextMarker = negativeTestMarkers[i + 1]?.[1];
  const end = nextMarker ? diagnosticSql.indexOf(nextMarker) : diagnosticSql.indexOf("-- 12)");
  const negBlock = diagnosticSql.slice(start, end);

  assert.match(negBlock, /v_rejected boolean := false;/);
  assert.match(negBlock, new RegExp(`WHEN SQLSTATE '${sqlstate}'\\s*THEN\\s*v_rejected := true;`));
  assert.doesNotMatch(negBlock, /WHEN OTHERS/);

  // El RAISE de fallo del test debe estar fuera del bloque interno BEGIN/EXCEPTION/END
  // que atrapa la excepción de la RPC (si no, se auto-declararía "ok" al atraparse él mismo).
  const innerExceptionIndex = negBlock.indexOf("EXCEPTION");
  const innerEndIndex = negBlock.indexOf("END;", innerExceptionIndex);
  const failRaiseIndex = negBlock.indexOf(`${testName}_FALLO`);
  assert.ok(
    innerExceptionIndex >= 0 && innerEndIndex >= 0 && failRaiseIndex > innerEndIndex,
    `${testName}: el RAISE EXCEPTION de fallo debe estar fuera del BEGIN/EXCEPTION que captura la RPC`,
  );
}

assert.match(diagnosticSql, /^ROLLBACK;\s*$/m);
assert.doesNotMatch(diagnosticSql, /^\s*COMMIT;\s*$/m);

console.log("confirmed operations and proforma assertions: ok");
