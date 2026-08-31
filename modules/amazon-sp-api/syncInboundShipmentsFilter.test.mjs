/**
 * Functional tests for production inbound sync helpers.
 * Imports the real filter / quantity / v2024 pagination implementations.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  omitUnknownCantidadEnviada,
  parseOptionalQuantity,
  preserveExistingInboundQuantities,
  resolveInboundDiscrepancy,
  resolveInboundItemQuantities,
  SCHEMA_ALLOWS_NULL_EXPECTED,
  SCHEMA_CANTIDAD_ENVIADA_NOT_NULL_DEFAULT_ZERO,
} from "./inboundShipmentQuantitySemantics.ts";
import {
  filterShipmentsForSync,
  isCurrentYearAllowedTerminalStatus,
  isTerminalStatus,
} from "./inboundShipmentSyncFilter.ts";
import { paginateV2024InboundPlans } from "./v2024InboundPlansPagination.ts";

function applyOperativeScopeFilter(shipmentGroups, includeClosedCurrentYear = true) {
  const currentYear = new Date().getUTCFullYear();
  return shipmentGroups.filter((shipment) => {
    const year = shipment.shipment_year;
    const terminal = isTerminalStatus(shipment.estado);
    const isClosed = isCurrentYearAllowedTerminalStatus(shipment.estado);

    if (!terminal) return true;
    if (isClosed && year === currentYear && includeClosedCurrentYear) return true;
    if (shipment.review_required) return true;
    return false;
  });
}

// ─── Fixture factory ──────────────────────────────────────────────────────────

function makeShipment(id, name, status, rawOverride = {}) {
  return {
    amazon_shipment_id: id,
    amazon_inbound_plan_id: null,
    amazon_reference_id: null,
    shipment_name: name,
    status,
    destination_fc: null,
    created_at_amazon: null,
    updated_at_amazon: null,
    expected_units: 10,
    located_units: 0,
    raw_date_keys: [],
    raw_status: status,
    raw_shipment_name: name,
    items: [{ seller_sku: "TEST-SKU", sku_limpio: "TEST", producto_id: null, expected_quantity: 10, located_quantity: 0, received_quantity: 0, raw: {} }],
    raw: rawOverride,
  };
}

function makeOperativeGroup(id, estado, shipment_year, review_required = false) {
  return { shipment_id: id, estado, shipment_year, review_required };
}

const FROM_2026 = "2026-01-01T00:00:00.000Z";
const TO_2026 = "2026-12-31T23:59:59.999Z";
const CURRENT_YEAR = new Date().getUTCFullYear();

// ─── Tests del filtro de fecha / estado ──────────────────────────────────────

test("FIXTURE-01: IN_TRANSIT 2024 (date from name) con fromDate=2026 → INCLUIDO", () => {
  const shipment = makeShipment("FBA_TEST_2024", "Envío FBA (20/07/2024 10:30)", "IN_TRANSIT");
  const result = filterShipmentsForSync([shipment], FROM_2026, TO_2026, false, false, false);

  assert.strictEqual(result.shipments.length, 1, "debe estar incluido");
  assert.strictEqual(result.skippedByDate, 0, "skippedByDate debe ser 0");
  assert.strictEqual(result.skippedByStatus, 0, "skippedByStatus debe ser 0");
  assert.ok(
    result.includedNonTerminalCarryoverIds.some((s) => s.includes("FBA_TEST_2024")),
    "debe registrarse como carryover no-terminal",
  );
});

test("FIXTURE-02: IN_TRANSIT 2025 (date from name) con fromDate=2026 → INCLUIDO", () => {
  const shipment = makeShipment("FBA_TEST_2025", "Envío FBA (15/03/2025 08:00)", "IN_TRANSIT");
  const result = filterShipmentsForSync([shipment], FROM_2026, TO_2026, false, false, false);

  assert.strictEqual(result.shipments.length, 1, "debe estar incluido");
  assert.strictEqual(result.skippedByDate, 0);
  assert.strictEqual(result.skippedByStatus, 0);
});

test("FIXTURE-03: IN_TRANSIT 2026 (date from name) → INCLUIDO", () => {
  const shipment = makeShipment("FBA_TEST_2026", "Envío FBA (05/02/2026 09:00)", "IN_TRANSIT");
  const result = filterShipmentsForSync([shipment], FROM_2026, TO_2026, false, false, false);

  assert.strictEqual(result.shipments.length, 1, "debe estar incluido");
  assert.strictEqual(result.skippedByDate, 0);
  assert.strictEqual(result.skippedByStatus, 0);
});

test("FIXTURE-04: RECEIVING 2025 (date from name) → INCLUIDO", () => {
  const shipment = makeShipment("FBA_RECV_2025", "Recepción (10/11/2025 14:00)", "RECEIVING");
  const result = filterShipmentsForSync([shipment], FROM_2026, TO_2026, false, false, false);

  assert.strictEqual(result.shipments.length, 1);
  assert.strictEqual(result.skippedByDate, 0);
  assert.strictEqual(result.skippedByStatus, 0);
});

test("FIXTURE-05: CLOSED 2024 (terminal) con fromDate=2026 → EXCLUIDO por fecha", () => {
  const shipment = makeShipment("FBA_CLOSED_2024", "Cerrado (01/06/2024 12:00)", "CLOSED");
  const result = filterShipmentsForSync([shipment], FROM_2026, TO_2026, true, true, false);

  assert.strictEqual(result.shipments.length, 0, "CLOSED 2024 debe excluirse");
  assert.strictEqual(result.skippedByDate, 1, "debe contarse en skippedByDate");
  assert.ok(result.skippedByDateIds[0].includes("FBA_CLOSED_2024"));
});

test("FIXTURE-06: CLOSED 2025 (terminal) con fromDate=2026 → EXCLUIDO por fecha", () => {
  const shipment = makeShipment("FBA_CLOSED_2025", "Cerrado (20/08/2025 16:00)", "CLOSED");
  const result = filterShipmentsForSync([shipment], FROM_2026, TO_2026, true, true, false);

  assert.strictEqual(result.shipments.length, 0);
  assert.strictEqual(result.skippedByDate, 1);
});

test("FIXTURE-07: CLOSED 2026 + includeClosedCurrentYear=true → INCLUIDO", () => {
  const shipment = makeShipment("FBA_CLOSED_2026", "Cerrado (15/04/2026 11:00)", "CLOSED");
  const result = filterShipmentsForSync([shipment], FROM_2026, TO_2026, true, true, false);

  assert.strictEqual(result.shipments.length, 1, "CLOSED 2026 debe incluirse");
  assert.strictEqual(result.skippedByDate, 0);
  assert.strictEqual(result.skippedByStatus, 0);
});

test("FIXTURE-08: CLOSED 2026 + includeClosedCurrentYear=false → EXCLUIDO por estado", () => {
  const shipment = makeShipment("FBA_CLOSED_2026_X", "Cerrado (15/04/2026 11:00)", "CLOSED");
  const result = filterShipmentsForSync([shipment], FROM_2026, TO_2026, false, false, false);

  assert.strictEqual(result.shipments.length, 0);
  assert.strictEqual(result.skippedByStatus, 1, "CLOSED sin includeClosedCurrentYear → skippedByStatus");
});

test("FIXTURE-09: IN_TRANSIT sin fecha se incluye aunque allowActiveWithoutDate=false", () => {
  // El nombre no tiene formato (DD/MM/YYYY HH:MM), no hay createdAt, updatedAt
  const shipment = makeShipment("FBA15M83112Q", "FBA15M83112Q", "IN_TRANSIT");
  const resultStrict = filterShipmentsForSync([shipment], FROM_2026, TO_2026, false, false, false);
  assert.strictEqual(resultStrict.shipments.length, 1, "IN_TRANSIT sin fecha debe incluirse");
  assert.strictEqual(resultStrict.skippedByMissingDate, 0);
  assert.strictEqual(resultStrict.skippedByStatus, 0, "NO debe ir a skippedByStatus");
  assert.strictEqual(resultStrict.activeWithoutDateImported, 1);
});

test("FIXTURE-09B: RECEIVING sin fecha se incluye aunque allowActiveWithoutDate=false", () => {
  const shipment = makeShipment("FBA_RECEIVING_NO_DATE", "sin fecha", "RECEIVING");
  const result = filterShipmentsForSync([shipment], FROM_2026, TO_2026, false, false, false);
  assert.strictEqual(result.shipments.length, 1);
  assert.strictEqual(result.skippedByMissingDate, 0);
  assert.strictEqual(result.activeWithoutDateImported, 1);
});

test("FIXTURE-09C: CLOSED sin fecha se excluye fail-closed", () => {
  const shipment = makeShipment("FBA_CLOSED_NO_DATE", "sin fecha", "CLOSED");
  const result = filterShipmentsForSync([shipment], FROM_2026, TO_2026, true, true, false);
  assert.strictEqual(result.shipments.length, 0);
  assert.strictEqual(result.skippedByStatus, 1);
  assert.strictEqual(result.activeWithoutDateImported, 0);
});

test("QUANTITY-01: v2024-only persiste expected=30, shipped=0, received=0", () => {
  assert.deepStrictEqual(
    resolveInboundItemQuantities({
      expected_quantity: 30,
      shipped_quantity: 0,
      received_quantity: 0,
      located_quantity: 0,
    }),
    { expectedQty: 30, shippedQty: 0, receivedQty: 0, locatedQty: 0 },
  );
});

test("QUANTITY-02 / MERGED-C: v2024+v0 persiste expected=30, shipped=28, received=10", () => {
  assert.deepStrictEqual(
    resolveInboundItemQuantities({
      expected_quantity: 30,
      shipped_quantity: 28,
      received_quantity: 10,
      located_quantity: 10,
    }),
    { expectedQty: 30, shippedQty: 28, receivedQty: 10, locatedQty: 10 },
  );
});

test("QUANTITY-UNKNOWN: 0 is Amazon zero; missing is null", () => {
  assert.strictEqual(parseOptionalQuantity(0), 0);
  assert.strictEqual(parseOptionalQuantity(undefined), null);
  assert.strictEqual(parseOptionalQuantity(null), null);
  assert.strictEqual(parseOptionalQuantity(""), null);
  assert.ok(SCHEMA_ALLOWS_NULL_EXPECTED, "cantidad_esperada / quantity_expected are nullable");
  assert.ok(
    SCHEMA_CANTIDAD_ENVIADA_NOT_NULL_DEFAULT_ZERO,
    "cantidad_enviada cannot store unknown as NULL",
  );
});

test("V0-ONLY-A: existing expected=36 preserved when incoming expected is null", () => {
  const final = preserveExistingInboundQuantities(
    { expected: null, shipped: 36, received: 34, located: null },
    { expected: 36, shipped: 36, received: 34, located: null },
  );
  assert.strictEqual(final.expected, 36);
  assert.strictEqual(final.shipped, 36);
  assert.strictEqual(final.received, 34);
});

test("V0-ONLY-B: new v0-only expected stays null, never invented 0", () => {
  const incoming = resolveInboundItemQuantities({
    expected_quantity: null,
    shipped_quantity: 20,
    received_quantity: 0,
    located_quantity: null,
  });
  assert.strictEqual(incoming.expectedQty, null);
  assert.strictEqual(incoming.shippedQty, 20);
  assert.strictEqual(incoming.receivedQty, 0);
  const final = preserveExistingInboundQuantities(
    {
      expected: incoming.expectedQty,
      shipped: incoming.shippedQty,
      received: incoming.receivedQty,
      located: incoming.locatedQty,
    },
    null,
  );
  assert.strictEqual(final.expected, null);
  assert.notStrictEqual(final.expected, 0);
});

test("MISSING-D: missing QuantityShipped → shipped=null, not 0", () => {
  const qty = resolveInboundItemQuantities({
    expected_quantity: 10,
    shipped_quantity: undefined,
    received_quantity: 4,
    located_quantity: undefined,
  });
  assert.strictEqual(qty.shippedQty, null);
  assert.notStrictEqual(qty.shippedQty, 0);
});

test("MISSING-E: missing QuantityReceived → received=null, not 0", () => {
  const qty = resolveInboundItemQuantities({
    expected_quantity: 10,
    shipped_quantity: 8,
    received_quantity: undefined,
    located_quantity: undefined,
  });
  assert.strictEqual(qty.receivedQty, null);
  assert.notStrictEqual(qty.receivedQty, 0);
});

test("DISCREPANCY-F: shipped=34 received=36 → discrepancy=-2", () => {
  assert.strictEqual(resolveInboundDiscrepancy(34, 36), -2);
});

test("DISCREPANCY-G: shipped=null received=0 → discrepancy=null", () => {
  assert.strictEqual(resolveInboundDiscrepancy(null, 0), null);
});

test("DISCREPANCY-SIGN: shipped=36 received=34 → discrepancy=2, no Math.max clamp", () => {
  assert.strictEqual(resolveInboundDiscrepancy(36, 34), 2);
});

test("OMIT-ENVIADA: unknown shipped omits NOT NULL cantidad_enviada", () => {
  const payload = omitUnknownCantidadEnviada({
    sku: "X",
    cantidad_enviada: null,
    cantidad_esperada: null,
  });
  assert.ok(!("cantidad_enviada" in payload));
  assert.strictEqual(payload.cantidad_esperada, null);
});

test("V2024-PAGE-SIZE: listInboundPlans usa pageSize=30", async () => {
  /** @type {string | undefined} */
  let seenPageSize;
  await paginateV2024InboundPlans({
    maxPages: 1,
    request: async (input) => {
      assert.strictEqual(input.path, "/inbound/fba/2024-03-20/inboundPlans");
      seenPageSize = input.query.pageSize;
      return { inboundPlans: [] };
    },
  });
  assert.strictEqual(seenPageSize, "30");
  const parsed = Number(seenPageSize);
  assert.ok(Number.isFinite(parsed) && parsed <= 30);
});

test("V2024-MAX-01: página 20 sin token completa la adquisición", async () => {
  let calls = 0;
  const result = await paginateV2024InboundPlans({
    maxPages: 20,
    request: async () => {
      calls += 1;
      return {
        inboundPlans: [],
        pagination: calls < 20 ? { nextToken: `TOKEN_${calls}` } : {},
      };
    },
  });
  assert.strictEqual(calls, 20);
  assert.strictEqual(result.pagesFetched, 20);
  assert.strictEqual(result.acquisitionComplete, true);
});

test("V2024-MAX-02: página 20 con token pendiente deja adquisición incompleta", async () => {
  let calls = 0;
  const result = await paginateV2024InboundPlans({
    maxPages: 20,
    request: async () => {
      calls += 1;
      return {
        inboundPlans: [],
        pagination: { nextToken: `TOKEN_${calls}` },
      };
    },
  });
  assert.strictEqual(calls, 20);
  assert.strictEqual(result.pagesFetched, 20);
  assert.strictEqual(result.acquisitionComplete, false);
});

test("FIXTURE-10: CANCELLED 2024 → terminal → EXCLUIDO por fecha", () => {
  const shipment = makeShipment("FBA_CANCEL_2024", "Cancelado (03/03/2024 09:00)", "CANCELLED");
  const result = filterShipmentsForSync([shipment], FROM_2026, TO_2026, true, true, false);
  assert.strictEqual(result.shipments.length, 0);
  assert.strictEqual(result.skippedByDate, 1);
});

test("FIXTURE-11: mezcla realista — 3 IN_TRANSIT + 2 CLOSED OLD → 3 incluidos, 2 excluidos", () => {
  const shipments = [
    makeShipment("FBA15M83112Q", "Shipment A (20/07/2024 10:30)", "IN_TRANSIT"),
    makeShipment("FBA15M8F7BTS", "Shipment B (15/03/2025 08:00)", "IN_TRANSIT"),
    makeShipment("FBA15M1HX76N", "Shipment C (05/02/2026 09:00)", "IN_TRANSIT"),
    makeShipment("FBA_C1", "Closed D (01/06/2024 12:00)", "CLOSED"),
    makeShipment("FBA_C2", "Closed E (20/08/2025 16:00)", "CLOSED"),
  ];
  const result = filterShipmentsForSync(shipments, FROM_2026, TO_2026, true, true, false);

  assert.strictEqual(result.shipments.length, 3, "los 3 IN_TRANSIT deben pasar");
  assert.strictEqual(result.skippedByDate, 2, "los 2 CLOSED viejos deben excluirse por fecha");
  assert.strictEqual(result.skippedByStatus, 0);
  assert.strictEqual(result.includedNonTerminalCarryoverIds.length, 2, "2024 y 2025 son carryover");
});

// ─── Tests del scope operativo ────────────────────────────────────────────────

test("SCOPE-01: IN_TRANSIT 2024 en operative scope → VISIBLE", () => {
  const shipments = [makeOperativeGroup("S_IN_TRANSIT_2024", "IN_TRANSIT", 2024)];
  const visible = applyOperativeScopeFilter(shipments);
  assert.strictEqual(visible.length, 1, "IN_TRANSIT 2024 debe ser visible en operativos");
});

test("SCOPE-02: IN_TRANSIT 2025 en operative scope → VISIBLE", () => {
  const shipments = [makeOperativeGroup("S_IN_TRANSIT_2025", "IN_TRANSIT", 2025)];
  const visible = applyOperativeScopeFilter(shipments);
  assert.strictEqual(visible.length, 1);
});

test("SCOPE-03: RECEIVING 2023 en operative scope → VISIBLE (no-terminal)", () => {
  const shipments = [makeOperativeGroup("S_RECV_2023", "RECEIVING", 2023)];
  const visible = applyOperativeScopeFilter(shipments);
  assert.strictEqual(visible.length, 1, "RECEIVING 2023 activo debe ser visible");
});

test("SCOPE-04: CLOSED 2024 en operative scope → OCULTO", () => {
  const shipments = [makeOperativeGroup("S_CLOSED_2024", "CLOSED", 2024)];
  const visible = applyOperativeScopeFilter(shipments, true);
  assert.strictEqual(visible.length, 0, "CLOSED 2024 no debe aparecer en operativos");
});

test(`SCOPE-05: CLOSED ${CURRENT_YEAR} + includeClosedCurrentYear=true → VISIBLE`, () => {
  const shipments = [makeOperativeGroup("S_CLOSED_CY", "CLOSED", CURRENT_YEAR)];
  const visible = applyOperativeScopeFilter(shipments, true);
  assert.strictEqual(visible.length, 1);
});

test(`SCOPE-06: CLOSED ${CURRENT_YEAR} + includeClosedCurrentYear=false → OCULTO`, () => {
  const shipments = [makeOperativeGroup("S_CLOSED_CY_X", "CLOSED", CURRENT_YEAR)];
  const visible = applyOperativeScopeFilter(shipments, false);
  assert.strictEqual(visible.length, 0);
});

test("SCOPE-07: CLOSED 2022 + review_required=true → VISIBLE (requiere atención)", () => {
  const shipments = [makeOperativeGroup("S_CLOSED_OLD_REVIEW", "CLOSED", 2022, true)];
  const visible = applyOperativeScopeFilter(shipments, true);
  assert.strictEqual(visible.length, 1, "review_required siempre visible independientemente del año");
});

// ─── Tests de skippedByDateIds diagnóstico ────────────────────────────────────

test("DIAG-01: skippedByDateIds contiene información suficiente para identificar causa", () => {
  const shipment = makeShipment("FBA_OLD_CLOSED", "Cerrado (01/01/2023 09:00)", "CLOSED");
  const result = filterShipmentsForSync([shipment], FROM_2026, TO_2026, true, true, false);
  assert.strictEqual(result.skippedByDate, 1);
  assert.ok(result.skippedByDateIds.length > 0, "debe haber al menos un ID registrado");
  assert.ok(
    result.skippedByDateIds[0].includes("FBA_OLD_CLOSED"),
    "el ID del shipment debe estar en skippedByDateIds",
  );
  assert.ok(
    result.skippedByDateIds[0].includes("terminal"),
    "debe indicar que fue excluido por ser terminal",
  );
});

test("DIAG-02: includedNonTerminalCarryoverIds sólo recoge carryover de años anteriores", () => {
  const shipments = [
    makeShipment("FBA_2024", "Envío (10/04/2024 12:00)", "IN_TRANSIT"),
    makeShipment("FBA_2026", "Envío (10/04/2026 12:00)", "IN_TRANSIT"),
  ];
  const result = filterShipmentsForSync(shipments, FROM_2026, TO_2026, false, false, false);
  assert.strictEqual(result.shipments.length, 2, "ambos deben pasar el filtro");
  assert.strictEqual(result.includedNonTerminalCarryoverIds.length, 1, "solo el de 2024 es carryover");
  assert.ok(result.includedNonTerminalCarryoverIds[0].includes("FBA_2024"));
  assert.ok(result.includedNonTerminalCarryoverIds[0].includes("2024"));
});

// ─── Source-level: confirmación de arquitectura de paginación y discovery combinado ───

import { readFile } from "node:fs/promises";
const DIAGNOSTIC_FILE = "modules/amazon-sp-api/inboundShipmentsDiagnosticService.ts";
const SYNC_SERVICE_FILE = "modules/amazon-sp-api/syncInboundShipmentsToAmazonEnviosService.ts";
const FILTER_FILE = "modules/amazon-sp-api/inboundShipmentSyncFilter.ts";
const V2024_PAGINATION_FILE = "modules/amazon-sp-api/v2024InboundPlansPagination.ts";

let diagSource, syncSource, filterSource, v2024PaginationSource;
test.before(async () => {
  [diagSource, syncSource, filterSource, v2024PaginationSource] = await Promise.all([
    readFile(DIAGNOSTIC_FILE, "utf8"),
    readFile(SYNC_SERVICE_FILE, "utf8"),
    readFile(FILTER_FILE, "utf8"),
    readFile(V2024_PAGINATION_FILE, "utf8"),
  ]);
});

// ─── A) V0 ACTIVE PAGINATION: multiple pages, NextToken consumed ─────────────

test("PAGE-A1: fetchV0ShipmentsPaginated usa QueryType correctamente", () => {
  assert.match(
    diagSource,
    /async function fetchV0ShipmentsPaginated/,
    "fetchV0ShipmentsPaginated debe existir",
  );
  // Page 1: QueryType=SHIPMENT
  assert.match(
    diagSource,
    /QueryType:\s*["']SHIPMENT["']/,
    "Primera página debe usar QueryType=SHIPMENT",
  );
  // Page 2+: QueryType=NEXT_TOKEN
  assert.match(
    diagSource,
    /QueryType:\s*["']NEXT_TOKEN["']/,
    "Páginas siguientes deben usar QueryType=NEXT_TOKEN",
  );
  // Detecta ciclos
  assert.match(
    diagSource,
    /seenTokens\.has\(newToken\)/,
    "fetchV0ShipmentsPaginated debe detectar ciclos con seenTokens",
  );
});

test("PAGE-A2: fetchV0ActiveShipmentsPaginated pasa lastUpdatedAfter=null (nunca usa fecha)", () => {
  assert.match(
    diagSource,
    /async function fetchV0ActiveShipmentsPaginated/,
    "fetchV0ActiveShipmentsPaginated debe existir",
  );
  // La llamada debe pasar lastUpdatedAfter: null
  assert.match(
    diagSource,
    /fetchV0ActiveShipmentsPaginated[\s\S]{0,200}lastUpdatedAfter:\s*null/s,
    "fetchV0ActiveShipmentsPaginated debe pasar lastUpdatedAfter: null",
  );
});

test("PAGE-A3: paginación tiene límite máximo de páginas absoluto", () => {
  assert.match(
    diagSource,
    /V0_ABSOLUTE_MAX_PAGES\s*=\s*\d+/,
    "Debe existir límite absoluto de páginas para evitar loops infinitos",
  );
  assert.match(
    diagSource,
    /maxPages[\s\S]{0,100}V0_ABSOLUTE_MAX_PAGES/,
    "El límite de páginas debe usarse en la paginación",
  );
});

test("PAGE-A4: paginación devuelve diagnóstico completo: pagesFetched, acquisitionComplete, cycleDetected", () => {
  assert.match(diagSource, /pagesFetched/, "Debe reportar pagesFetched");
  assert.match(diagSource, /acquisitionComplete/, "Debe reportar acquisitionComplete");
  assert.match(diagSource, /cycleDetected/, "Debe reportar cycleDetected");
  assert.match(diagSource, /nextTokenPending/, "Debe reportar nextTokenPending");
});

test("PAGE-A5: deduplicación por ShipmentId en cada página", () => {
  // Verify deduplication logic exists within the pagination function
  assert.match(
    diagSource,
    /const byId = new Map/,
    "Paginación debe usar Map para deduplicar",
  );
  assert.match(
    diagSource,
    /if \(id && !byId\.has\(id\)\)/,
    "Paginación debe verificar duplicados con byId.has",
  );
});

// ─── B) TERMINAL PAGINATION: also paginated ─────────────────────────────────

test("PAGE-B1: fetchV0TerminalShipmentsPaginated existe y USA lastUpdatedAfter", () => {
  assert.match(
    diagSource,
    /async function fetchV0TerminalShipmentsPaginated/,
    "fetchV0TerminalShipmentsPaginated debe existir",
  );
  assert.match(
    diagSource,
    /fetchV0TerminalShipmentsPaginated\s*\(\s*lastUpdatedAfter/,
    "fetchV0TerminalShipmentsPaginated acepta lastUpdatedAfter",
  );
});

// ─── C) V2024 + V0 COMBINED: NOT mutually exclusive ─────────────────────────

test("COMBINED-C1: buildAmazonInboundShipmentsDiagnostic combina v2024 AND v0", () => {
  // v2024 se intenta primero, pero v0 SIEMPRE se ejecuta después (no early return)
  assert.match(
    diagSource,
    /buildAmazonInboundShipmentsDiagnostic[\s\S]*?fetchV2024Shipments[\s\S]*?fetchV0ShipmentsSeparated/s,
    "Debe llamar TANTO a v2024 como a v0",
  );
  // Verifica que no hay early return después de v2024
  // El return "combined" solo debe aparecer al final después de deduplicar
  assert.match(
    diagSource,
    /source:\s*["']combined["']/,
    "Debe soportar source='combined' cuando ambas APIs devuelven datos",
  );
});

test("COMBINED-C2: mergeV2024AndV0Shipments hace merge semántico", () => {
  assert.match(
    diagSource,
    /function mergeV2024AndV0Shipments/,
    "mergeV2024AndV0Shipments debe existir",
  );
  assert.match(
    diagSource,
    /mergeV2024AndV0Shipments\(v2024Shipments,\s*v0Shipments\)/,
    "buildAmazonInboundShipmentsDiagnostic debe usar merge semántico",
  );
  // v0 es autoritativo para datos operativos
  assert.match(
    diagSource,
    /status:\s*v0Ship\.status/,
    "v0 debe ser autoritativo para status",
  );
  // v2024 proporciona enrichment
  assert.match(
    diagSource,
    /amazon_inbound_plan_id:\s*v2024Ship\.amazon_inbound_plan_id/,
    "v2024 debe proporcionar inboundPlanId",
  );
});

test("COMBINED-C3: FullDiscoveryDiagnostic incluye shipmentsFetchedV2024 y shipmentsAfterDedup", () => {
  assert.match(
    diagSource,
    /shipmentsFetchedV2024:/,
    "FullDiscoveryDiagnostic debe tener shipmentsFetchedV2024",
  );
  assert.match(
    diagSource,
    /shipmentsAfterDedup:/,
    "FullDiscoveryDiagnostic debe tener shipmentsAfterDedup",
  );
  assert.match(
    diagSource,
    /v2024AcquisitionComplete:/,
    "FullDiscoveryDiagnostic debe tener v2024AcquisitionComplete",
  );
  assert.match(
    diagSource,
    /discoveryComplete:/,
    "FullDiscoveryDiagnostic debe tener discoveryComplete global",
  );
});

// ─── D) activeDiscoveryUsedLastUpdatedAfter MUST always be false ────────────

test("ACTIVE-D1: activeDiscoveryUsedLastUpdatedAfter siempre es false en V0DiscoveryDiagnostic", () => {
  assert.match(
    diagSource,
    /activeDiscoveryUsedLastUpdatedAfter:\s*false/,
    "activeDiscoveryUsedLastUpdatedAfter debe ser siempre false",
  );
});

// ─── E) discoveryComplete separado de v2024EnrichmentComplete ───────────────

test("COMPLETE-E1: discoveryComplete se basa en v0Complete y v2024Ok", () => {
  // discoveryComplete depends on v0Complete (which checks active+terminal + shipment items)
  assert.match(
    diagSource,
    /v0Complete\s*=[\s\S]{0,200}activeAcquisitionComplete/s,
    "v0Complete debe depender de activeAcquisitionComplete",
  );
  assert.match(
    diagSource,
    /shipmentItemsAcquisitionComplete/,
    "v0Complete debe verificar shipmentItemsAcquisitionComplete",
  );
  assert.match(
    diagSource,
    /discoveryComplete\s*=\s*v0Complete/,
    "discoveryComplete debe depender de v0Complete",
  );
});

test("COMPLETE-E2: sync service usa discovery.discoveryComplete para acquisitionComplete", () => {
  assert.match(
    syncSource,
    /acquisitionComplete:\s*diagnostic\.discovery\?\.discoveryComplete/,
    "acquisitionComplete en summary debe basarse en discoveryComplete",
  );
});

// ─── F) V0DiscoveryDiagnostic tiene todos los campos de paginación ──────────

test("DIAG-F1: V0DiscoveryDiagnostic tiene campos de paginación activos", () => {
  assert.match(diagSource, /activePagesFetched:/, "Debe tener activePagesFetched");
  assert.match(diagSource, /activeAcquisitionComplete:/, "Debe tener activeAcquisitionComplete");
  assert.match(diagSource, /activeNextTokenPending:/, "Debe tener activeNextTokenPending");
  assert.match(diagSource, /activeCycleDetected:/, "Debe tener activeCycleDetected");
});

test("DIAG-F2: V0DiscoveryDiagnostic tiene campos de paginación terminales", () => {
  assert.match(diagSource, /terminalPagesFetched:/, "Debe tener terminalPagesFetched");
  assert.match(diagSource, /terminalAcquisitionComplete:/, "Debe tener terminalAcquisitionComplete");
  assert.match(diagSource, /terminalNextTokenPending:/, "Debe tener terminalNextTokenPending");
  assert.match(diagSource, /terminalCycleDetected:/, "Debe tener terminalCycleDetected");
});

// ─── G) V0 QueryType: Page 1 vs Page 2 request structure ────────────────────

test("V0QUERY-G1: Page 1 usa QueryType=SHIPMENT con ShipmentStatusList", () => {
  // Verify isFirstPage logic exists
  assert.match(
    diagSource,
    /const isFirstPage = nextToken === null/,
    "Debe detectar primera página por nextToken===null",
  );
  // First page query structure
  assert.match(
    diagSource,
    /isFirstPage[\s\S]{0,50}\?[\s\S]{0,100}QueryType:\s*["']SHIPMENT["'][\s\S]{0,100}ShipmentStatusList/s,
    "Primera página debe tener QueryType=SHIPMENT y ShipmentStatusList",
  );
});

test("V0QUERY-G2: Page 2+ usa QueryType=NEXT_TOKEN con NextToken solamente", () => {
  // Subsequent pages query structure - must have NEXT_TOKEN and NextToken
  assert.match(
    diagSource,
    /QueryType:\s*["']NEXT_TOKEN["']/,
    "Páginas siguientes deben tener QueryType=NEXT_TOKEN",
  );
  assert.match(
    diagSource,
    /QueryType:\s*["']NEXT_TOKEN["'][\s\S]{0,30}NextToken:\s*nextToken/s,
    "Páginas siguientes deben tener NextToken inmediatamente después de QueryType",
  );
  // The else branch (page 2+) should only have QueryType and NextToken properties
  // This is verified by the code structure: isFirstPage ? {...} : {QueryType, NextToken}
  assert.match(
    diagSource,
    /isFirstPage[\s\S]{0,50}\?[\s\S]{0,300}:[\s\S]{0,50}\{[\s\r\n\t ]*QueryType:\s*["']NEXT_TOKEN["'],[\s\r\n\t ]*NextToken:/s,
    "Else branch (page 2+) solo debe tener QueryType y NextToken",
  );
});

// ─── H) V2024 Pagination and Empty Handling ─────────────────────────────────

test("V2024-H1: fetchV2024Shipments pagina con paginationToken", () => {
  assert.match(
    diagSource,
    /async function fetchV2024Shipments\(\)/,
    "fetchV2024Shipments debe existir sin parámetro limit",
  );
  assert.match(
    diagSource,
    /paginateV2024InboundPlans/,
    "Debe delegar la paginación v2024 al helper extraído",
  );
  assert.match(
    v2024PaginationSource,
    /paginationToken/,
    "Debe usar paginationToken para paginación v2024",
  );
  assert.match(
    diagSource,
    /V2024_ABSOLUTE_MAX_PAGES/,
    "Debe tener límite de páginas para v2024",
  );
});

test("V2024-H2: v2024 vacío es NOT failure (cuenta legacy)", () => {
  assert.match(
    diagSource,
    /isEmpty:\s*true/,
    "Debe reportar isEmpty para cuentas legacy",
  );
  assert.match(
    diagSource,
    /v2024IsEmpty/,
    "buildAmazonInboundShipmentsDiagnostic debe manejar v2024IsEmpty",
  );
  // Empty v2024 should make v2024AcquisitionComplete true
  assert.match(
    diagSource,
    /v2024AcquisitionComplete.*\|\|.*v2024IsEmpty/,
    "v2024 vacío debe marcar acquisitionComplete como true",
  );
});

test("V2024-H3: discoveryComplete no falla solo porque v2024 es empty", () => {
  // v2024 empty must not block discovery
  assert.match(
    diagSource,
    /v2024IsEmpty[\s\S]{0,50}\?\s*v2024AcquisitionComplete/s,
    "v2024 empty hace que v2024Ok dependa solo de acquisitionComplete",
  );
  assert.match(
    diagSource,
    /discoveryComplete\s*=\s*v0Complete\s*&&\s*v2024Ok/,
    "discoveryComplete debe basarse en v0Complete y v2024Ok",
  );
});

test("V2024-H4: v2024 ERROR debe marcar discoveryComplete=false", () => {
  // v2024 error must make discovery partial
  assert.match(
    diagSource,
    /v2024Error[\s\S]{0,20}\?\s*false/s,
    "v2024 error debe hacer v2024Ok=false",
  );
});

// ─── I) Semantic Merge preserves v0 shipped, uses v2024 expected ─────────────

test("MERGE-I1: mergeItemsBySku separa expected (v2024) de shipped (v0)", () => {
  assert.match(
    diagSource,
    /function mergeItemsBySku/,
    "mergeItemsBySku debe existir",
  );
  // v2024 expected
  assert.match(
    diagSource,
    /expected_quantity:\s*v2024Item\.expected_quantity/,
    "expected_quantity debe venir de v2024",
  );
  // v0 shipped
  assert.match(
    diagSource,
    /shipped_quantity:\s*v0Item\.shipped_quantity/,
    "shipped_quantity debe venir de v0",
  );
  // v0 received
  assert.match(
    diagSource,
    /received_quantity:\s*v0Item\.received_quantity/,
    "received_quantity debe venir de v0",
  );
});

test("MERGE-I2: mergeV2024AndV0Shipments usa mergeItemsBySku", () => {
  assert.match(
    diagSource,
    /mergeItemsBySku\(v2024Ship\.items,\s*v0Ship\.items\)/,
    "mergeV2024AndV0Shipments debe usar mergeItemsBySku",
  );
});

test("MERGE-I3: shipped_quantity viene de QuantityShipped, no QuantityInCase", () => {
  assert.match(
    diagSource,
    /shipped\s*=\s*parseOptionalQuantity[\s\S]{0,80}QuantityShipped/s,
    "shipped debe venir de QuantityShipped via parseOptionalQuantity",
  );
  const expectedMatch = diagSource.match(
    /expected\s*=\s*parseOptionalQuantity\s*\(\s*pick\s*\(raw,\s*\[([^\]]+)\]/s,
  );
  assert.ok(expectedMatch, "expected debe mapearse con parseOptionalQuantity");
  assert.doesNotMatch(
    expectedMatch[1],
    /QuantityShipped/,
    "expected NO debe usar QuantityShipped",
  );
  assert.doesNotMatch(
    expectedMatch[1],
    /QuantityInCase/,
    "expected NO debe usar QuantityInCase",
  );
});

test("UNKNOWN-PRESERVE: sync preserva expected existente y no clampa discrepancia", () => {
  assert.match(
    syncSource,
    /preserveExistingInboundQuantities/,
    "El upsert debe preservar cantidades existentes cuando incoming es unknown",
  );
  assert.match(
    syncSource,
    /loadExistingAmazonEnviosQuantities/,
    "Debe cargar cantidades persistidas antes del upsert",
  );
  assert.match(
    syncSource,
    /resolveInboundDiscrepancy/,
    "La discrepancia debe usar la semántica signed/null",
  );
  assert.doesNotMatch(
    syncSource,
    /Math\.max\(0,\s*shippedQty\s*-\s*receivedQty\)/,
    "No debe clamparse la discrepancia a >= 0",
  );
});

test("MERGE-I4: mergeV2024AndV0Shipments añade enrichment v2024", () => {
  // v2024 enrichment for inboundPlanId
  assert.match(
    diagSource,
    /amazon_inbound_plan_id:\s*v2024Ship\.amazon_inbound_plan_id\s*\?\?\s*v0Ship\.amazon_inbound_plan_id/,
    "inboundPlanId debe preferir v2024 sobre v0",
  );
  assert.match(
    diagSource,
    /amazon_reference_id:\s*v2024Ship\.amazon_reference_id\s*\?\?\s*v0Ship\.amazon_reference_id/,
    "referenceId debe preferir v2024 sobre v0",
  );
});

// ─── K) V2024 nested token handling ─────────────────────────────────────────

test("TOKEN-K1: v2024 extrae token de pagination.nextToken", () => {
  assert.match(
    v2024PaginationSource,
    /pagination\.nextToken/,
    "Debe extraer nextToken de objeto pagination anidado",
  );
  assert.match(
    v2024PaginationSource,
    /root\.pagination \?\? payload\.pagination/,
    "Debe parsear pagination como objeto, no String()",
  );
});

// ─── L) Active without date intrinsically included ──────────────────────────

test("ACTIVE-L1: non-terminal sin fecha se incluye siempre", () => {
  assert.match(
    filterSource,
    /void allowActiveWithoutDate/,
    "allowActiveWithoutDate se ignora: non-terminal sin fecha se incluye siempre",
  );
  assert.match(
    filterSource,
    /activeWithoutDateImported \+= 1/,
    "Non-terminal sin fecha incrementa activeWithoutDateImported",
  );
  assert.doesNotMatch(
    filterSource,
    /skippedByMissingDate \+= 1/,
    "Non-terminal sin fecha no incrementa skippedByMissingDate",
  );
});

// ─── J) Exports para testing ────────────────────────────────────────────────

test("EXPORT-J1: filter helper exporta filterShipmentsForSync para testing", () => {
  assert.match(
    filterSource,
    /export function filterShipmentsForSync/,
    "filterShipmentsForSync debe estar exportado",
  );
});

test("EXPORT-J2: filter helper exporta parseShipmentNameDate para testing", () => {
  assert.match(
    filterSource,
    /export function parseShipmentNameDate/,
    "parseShipmentNameDate debe estar exportado",
  );
});

test("EXPORT-J3: filter helper exporta TERMINAL_STATUSES para testing", () => {
  assert.match(
    filterSource,
    /export const TERMINAL_STATUSES/,
    "TERMINAL_STATUSES debe estar exportado",
  );
});

test("EXPORT-J4: filter helper exporta NON_TERMINAL_STATUSES para testing", () => {
  assert.match(
    filterSource,
    /export const NON_TERMINAL_STATUSES/,
    "NON_TERMINAL_STATUSES debe estar exportado",
  );
});

test("EXPORT-J5: diagnostic service exporta V0DiscoveryDiagnostic type", () => {
  assert.match(
    diagSource,
    /export type V0DiscoveryDiagnostic/,
    "V0DiscoveryDiagnostic debe estar exportado",
  );
});

test("EXPORT-J6: diagnostic service exporta FullDiscoveryDiagnostic type", () => {
  assert.match(
    diagSource,
    /export type FullDiscoveryDiagnostic/,
    "FullDiscoveryDiagnostic debe estar exportado",
  );
});
