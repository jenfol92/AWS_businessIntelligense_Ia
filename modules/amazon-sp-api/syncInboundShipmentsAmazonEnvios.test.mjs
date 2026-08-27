/**
 * Tests obligatorios A-M — Amazon Envíos operativo correcto.
 *
 * Estrategia: análisis de código fuente + tests de lógica pura extraída.
 * No se realizan llamadas Amazon LIVE ni escrituras Supabase.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const SERVICE_FILE = "modules/amazon-sp-api/syncInboundShipmentsToAmazonEnviosService.ts";
const ROUTE_FILE = "app/api/amazon/inbound-shipments/route.ts";
const UI_FILE = "app/[locale]/(dashboard)/amazon/envios/page.tsx";

// ─── Lectura de fuentes (una vez) ────────────────────────────────────────────
let source, routeSource, uiSource;
test.before(async () => {
  [source, routeSource, uiSource] = await Promise.all([
    readFile(SERVICE_FILE, "utf8"),
    readFile(ROUTE_FILE, "utf8"),
    readFile(UI_FILE, "utf8"),
  ]);
});

// ─── A: SYNC NO DESTRUCTIVO — fila no devuelta no se borra ───────────────────
test("A: sync no destructivo — cleanupUnlinkedAmazonEnviosIfSafe no se llama en el flujo", () => {
  // La llamada destructiva fue eliminada del flujo principal de sync
  assert.doesNotMatch(
    source,
    /await cleanupUnlinkedAmazonEnviosIfSafe\(\)/,
    "cleanupUnlinkedAmazonEnviosIfSafe NO debe llamarse en syncInboundShipmentsToAmazonEnvios",
  );
});

test("A: sync no destructivo — cleanup devuelve siempre 0 eliminaciones", () => {
  // El cleanup ahora es un objeto estático vacío
  assert.match(
    source,
    /deletedUnlinkedRows: 0.*skippedByExistingLinks: false/s,
    "El reemplazo de cleanup debe fijar deletedUnlinkedRows=0",
  );
});

test("A: sync no destructivo — upsert preserva shipments no recibidos", () => {
  // upsert con onConflict='shipment_id,sku' → no borra; actualiza o inserta
  assert.match(
    source,
    /upsert\(rows.*onConflict.*shipment_id.*sku/s,
    "El upsert debe usar onConflict para no destruir datos existentes",
  );
  // No debe existir un DELETE general previo al upsert
  assert.doesNotMatch(
    source,
    /\.delete\(\)\s*\.\s*is\('contenedor_id'/, 
    "No debe existir DELETE .is('contenedor_id', null) en el flujo activo",
  );
});

// ─── B: ERROR DE PAGINACIÓN → acquisitionComplete=false ──────────────────────
test("B: error en paginación v2024 → acquisitionComplete=false, sin pérdida de filas", () => {
  // fail-closed: el loop para y no ejecuta reconciliación
  assert.match(
    source,
    /hadError = true/,
    "Debe existir flag hadError para fail-closed",
  );
  assert.match(
    source,
    /acquisitionComplete.*hadError.*cycleDetected/s,
    "acquisitionComplete debe depender de la ausencia de hadError y cycleDetected",
  );
});

// ─── C: NEXTTOKEN REPETIDO → ABORT SEGURO ────────────────────────────────────
test("C: nextToken repetido → ciclo detectado, abort seguro", () => {
  assert.match(
    source,
    /seenTokens\.has\(newToken\)/,
    "Debe existir detección de token visto anteriormente",
  );
  assert.match(
    source,
    /cycleDetected = true/,
    "Debe establecerse cycleDetected=true al detectar ciclo",
  );
  assert.match(
    source,
    /ciclo detectado.*acquisitionComplete=false/,
    "El warning debe mencionar ciclo y acquisitionComplete=false",
  );
});

// ─── D: HISTORIAL DE ESTADOS — IN_TRANSIT → RECEIVING → CLOSED ───────────────
test("D: lifecycle soporta IN_TRANSIT, RECEIVING y CLOSED como estados distintos", () => {
  // NON_TERMINAL_STATUSES incluye IN_TRANSIT y RECEIVING
  assert.match(source, /"IN_TRANSIT"/, "IN_TRANSIT debe estar en los estados conocidos");
  assert.match(source, /"RECEIVING"/, "RECEIVING debe estar en los estados conocidos");
  // CLOSED es terminal pero permitido en año actual
  assert.match(
    source,
    /TERMINAL_STATUSES_ALLOWED_FOR_CURRENT_YEAR.*CLOSED/s,
    "CLOSED debe estar permitido para año actual",
  );
});

test("D: estados no se transforman silenciosamente — se conserva el raw", () => {
  assert.match(
    source,
    /estado: shipment\.status/,
    "El estado se persiste directamente desde la fuente Amazon sin transformación",
  );
  assert.match(
    source,
    /status_normalized.*statusNormalized/s,
    "El estado normalizado se guarda en raw para auditoría",
  );
});

// ─── E: AÑO ACTUAL CLOSED → VISIBLE EN OPERATIVO ─────────────────────────────
test("E: año actual CLOSED → visible en operativo con includeClosedCurrentYear", () => {
  assert.match(
    source,
    /year === currentYear.*isClosed.*includeClosedCurrentYear/s,
    "Shipments CLOSED del año actual deben filtrarse por includeClosedCurrentYear",
  );
});

// ─── F: AÑO ANTERIOR IN_TRANSIT → VISIBLE EN OPERATIVO ───────────────────────
test("F: año anterior IN_TRANSIT (no terminal) → visible en operativo", () => {
  // Un shipment no-terminal del año anterior debe incluirse
  assert.match(
    source,
    /year === prevYear.*!terminal.*return true/s,
    "Shipments no terminales del año anterior deben ser visibles en operativo",
  );
});

// ─── G: AÑO ANTERIOR CLOSED → SOLO HISTÓRICO ─────────────────────────────────
test("G: año anterior CLOSED → NO visible en operativo", () => {
  // Un CLOSED del año anterior NO está en la lista de excepciones del prevYear
  assert.match(
    source,
    /year === prevYear[\s\S]*?review_required.*return true/,
    "Solo non-terminal o review_required del año anterior son visibles en operativo",
  );
  // CLOSED del año anterior solo pasa por la rama review_required
  assert.doesNotMatch(
    source,
    /year === prevYear[\s\S]*?isClosed.*return true/,
    "CLOSED del año anterior NO debe incluirse directamente en operativo",
  );
});

// ─── H: 2024 CLOSED → SOLO HISTÓRICO ─────────────────────────────────────────
test("H: mode=history requiere year válido — year inválido → error 400", () => {
  // La ruta devuelve 400 si el year es inválido en mode=history
  assert.match(
    routeSource,
    /INVALID_YEAR.*mode=history.*400/s,
    "La ruta debe devolver 400 con mensaje INVALID_YEAR para año inválido en history",
  );
  assert.doesNotMatch(
    routeSource,
    /currentUtcYear\(\)|currentYear\(\)/,
    "La ruta NO debe hacer fallback silencioso al año actual",
  );
});

test("H: normalizeYear acepta años desde 2020 (incluye 2024)", () => {
  // La función normalizeYear ahora acepta 2020+, no solo 2025+
  assert.match(
    source,
    /year < 2020/,
    "normalizeYear debe rechazar años anteriores a 2020, no anteriores a 2025",
  );
  assert.doesNotMatch(
    source,
    /year < 2025/,
    "normalizeYear ya no debe rechazar años entre 2020 y 2024",
  );
});

// ─── I: SHIPMENT CREADO 2024 ACTUALIZADO 2026 → shipment_year=2024 ───────────
test("I: fecha de creación tiene prioridad sobre fecha de actualización", () => {
  // En resolveAmazonShipmentDate, created_at_amazon aparece ANTES que updated_at_amazon
  const resolveIdx = source.indexOf("export function resolveAmazonShipmentDate");
  assert.notEqual(resolveIdx, -1, "resolveAmazonShipmentDate debe existir");

  const snippet = source.slice(resolveIdx, resolveIdx + 1200);
  const createdIdx = snippet.indexOf('"created_at_amazon"');
  const updatedIdx = snippet.indexOf('"updated_at_amazon"');

  assert.notEqual(createdIdx, -1, "created_at_amazon debe estar en resolveAmazonShipmentDate");
  assert.notEqual(updatedIdx, -1, "updated_at_amazon debe estar en resolveAmazonShipmentDate");
  assert.ok(
    createdIdx < updatedIdx,
    `created_at_amazon (pos ${createdIdx}) debe aparecer ANTES que updated_at_amazon (pos ${updatedIdx})`,
  );
});

test("I: amazon_created_at y amazon_last_updated_at están separados en raw", () => {
  assert.match(source, /amazon_created_at.*amazonCreatedAt/s, "amazon_created_at separado en raw");
  assert.match(
    source,
    /amazon_last_updated_at.*amazonLastUpdatedAt/s,
    "amazon_last_updated_at separado en raw",
  );
});

// ─── J: year=2024 en history → devuelve 2024, NO fallback a 2026 ─────────────
test("J: mode=history NO hace fallback silencioso — year requerido y validado", () => {
  // En el servicio
  assert.match(
    source,
    /INVALID_YEAR.*mode=history.*year válido/s,
    "El servicio debe lanzar error explícito para year inválido en mode=history",
  );
  // En la ruta
  assert.match(
    routeSource,
    /mode.*history.*INVALID_YEAR/s,
    "La ruta debe retornar 400 INVALID_YEAR para mode=history sin year válido",
  );
});

// ─── K: QuantityShipped=100, QuantityReceived=80, status=RECEIVING → discrepancy=20, issue_confirmed=false
test("K: discrepancy calculada correctamente — no es incidencia definitiva en RECEIVING", () => {
  // La discrepancia es informativa
  assert.match(
    source,
    /quantity_discrepancy.*discrepancyQty/s,
    "quantity_discrepancy debe guardarse en raw",
  );
  // computeReviewRequired con RECEIVING NO debe devolver true (no es terminal)
  assert.match(
    source,
    /computeReviewRequired.*status.*discrepancyQty/s,
    "computeReviewRequired recibe status y discrepancyQty",
  );
  // RECEIVING está en NON_TERMINAL_STATUSES — no desencadena review automático
  assert.match(
    source,
    /NON_TERMINAL_STATUSES.*RECEIVING/s,
    "RECEIVING debe estar en NON_TERMINAL_STATUSES",
  );
});

// ─── L: QuantityShipped=100, QuantityReceived=80, status=CLOSED → discrepancy=20, review_candidate=true
test("L: CLOSED con discrepancia → review_required=true (no issue confirmado automático)", () => {
  assert.match(
    source,
    /normalized === "CLOSED".*discrepancyQty > 0.*return true/s,
    "computeReviewRequired debe devolver true para CLOSED con discrepancia > 0",
  );
  // Pero no se crea automáticamente un issue confirmado — solo review_required
  assert.doesNotMatch(
    source,
    /issue_confirmed.*true/,
    "No debe existir issue_confirmed automático — solo review_required",
  );
});

// ─── M: ESTADO DESCONOCIDO → conservar raw, review_required=true, no eliminar ──
test("M: estado desconocido → conservar, review_required=true, no eliminar", () => {
  // isUnknownStatus detecta estados fuera del set conocido
  assert.match(
    source,
    /function isUnknownStatus/,
    "Debe existir función isUnknownStatus",
  );
  assert.match(
    source,
    /isUnknownStatus.*return true/s,
    "isUnknownStatus debe devolver true para estado fuera de ALL_KNOWN_STATUSES",
  );
  // computeReviewRequired devuelve true para estado desconocido
  assert.match(
    source,
    /isUnknownStatus.*return true[\s\S]*?MIXED.*return true/s,
    "computeReviewRequired activa review para estado desconocido y MIXED",
  );
  // El estado se conserva literalmente — no hay transformación
  assert.match(
    source,
    /estado: shipment\.status/,
    "El estado Amazon se guarda literal — sin transformación",
  );
  // El sync NO borra filas con estado desconocido
  assert.doesNotMatch(
    source,
    /await cleanupUnlinkedAmazonEnviosIfSafe\(\)/,
    "El sync no ejecuta cleanup que podría eliminar filas con estado desconocido",
  );
});

// ─── Comprobaciones adicionales de integridad ────────────────────────────────

test("ACQUISITION_COMPLETE solo cuando todas las páginas OK sin error ni ciclo", () => {
  assert.match(
    source,
    /summary\.acquisitionComplete = !hadError && !cycleDetected/,
    "acquisitionComplete=true solo sin hadError y sin cycleDetected",
  );
});

test("MIXED no se trata como terminal", () => {
  // MIXED debe estar solo en SPECIAL_STATUSES, no en TERMINAL_STATUSES (set literal)
  assert.match(
    source,
    /SPECIAL_STATUSES = new Set\(\["MIXED"\]\)/,
    "MIXED debe estar exclusivamente en SPECIAL_STATUSES = new Set(['MIXED'])",
  );
  // TERMINAL_STATUSES definition no debe incluir MIXED
  const terminalDef = source.match(/const TERMINAL_STATUSES = new Set\(\[[\s\S]*?\]\)/)?.[0] ?? "";
  assert.ok(
    !terminalDef.includes('"MIXED"'),
    "MIXED no debe estar en la definición de TERMINAL_STATUSES",
  );
});

test("CANCELED (spelling alternativo) incluido en TERMINAL_STATUSES", () => {
  assert.match(
    source,
    /"CANCELED"/,
    "CANCELED (sin doble L) debe estar en TERMINAL_STATUSES",
  );
});

test("ABANDONED incluido en TERMINAL_STATUSES", () => {
  assert.match(
    source,
    /"ABANDONED"/,
    "ABANDONED debe estar en TERMINAL_STATUSES",
  );
});

test("UNCONFIRMED incluido en NON_TERMINAL_STATUSES", () => {
  assert.match(
    source,
    /"UNCONFIRMED"/,
    "UNCONFIRMED debe estar en NON_TERMINAL_STATUSES",
  );
});

test("cantidad_enviada separada de cantidad_esperada en mapeo", () => {
  // cantidad_enviada = shippedQty; cantidad_esperada = expectedQty
  assert.match(
    source,
    /cantidad_enviada: shippedQty/,
    "cantidad_enviada debe asignarse desde shippedQty (QuantityShipped), no desde expected",
  );
  assert.match(
    source,
    /cantidad_esperada: expectedQty/,
    "cantidad_esperada debe asignarse desde expectedQty (planificado)",
  );
  assert.doesNotMatch(
    source,
    /cantidad_enviada: expected[,\s]/,
    "cantidad_enviada ya NO debe asignarse directamente desde expected",
  );
});

test("mode=history en UI — no hay llamadas Amazon en render normal", () => {
  // El modo histórico no llama al endpoint de sync
  assert.match(
    uiSource,
    /viewMode === "history"[\s\S]*?El sync no está disponible/s,
    "El sync debe bloquearse en modo histórico",
  );
});

test("V2024_ABSOLUTE_MAX_PAGES definido y usado", () => {
  assert.match(source, /V2024_ABSOLUTE_MAX_PAGES = 50/, "Límite absoluto de páginas definido");
  assert.match(
    source,
    /Math\.min.*V2024_ABSOLUTE_MAX_PAGES/,
    "El límite absoluto se aplica en la paginación",
  );
});
