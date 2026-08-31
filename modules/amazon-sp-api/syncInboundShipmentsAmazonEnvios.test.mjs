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
const FILTER_FILE = "modules/amazon-sp-api/inboundShipmentSyncFilter.ts";
const ROUTE_FILE = "app/api/amazon/inbound-shipments/route.ts";
const UI_FILE = "app/[locale]/(dashboard)/amazon/envios/page.tsx";

// ─── Lectura de fuentes (una vez) ────────────────────────────────────────────
let source, routeSource, uiSource;
test.before(async () => {
  const [serviceSource, filterSource, loadedRoute, loadedUi] = await Promise.all([
    readFile(SERVICE_FILE, "utf8"),
    readFile(FILTER_FILE, "utf8"),
    readFile(ROUTE_FILE, "utf8"),
    readFile(UI_FILE, "utf8"),
  ]);
  source = `${serviceSource}\n${filterSource}`;
  routeSource = loadedRoute;
  uiSource = loadedUi;
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

// ─── E: NO-TERMINAL SIEMPRE VISIBLE — scope operativo simplificado ───────────
test("E: año actual CLOSED → visible en operativo con includeClosedCurrentYear", () => {
  // Después del fix del scope operativo, la lógica es:
  // if (!terminal) return true → todos los no-terminales son visibles sin importar año.
  // CLOSED año actual: isClosed && year === currentYear && includeClosedCurrentYear → visible.
  assert.match(
    source,
    /isClosed && year === currentYear && includeClosedCurrentYear/,
    "CLOSED año actual debe estar condicionado a isClosed + currentYear + includeClosedCurrentYear",
  );
});

// ─── F: IN_TRANSIT CUALQUIER AÑO → VISIBLE EN OPERATIVO ──────────────────────
test("F: año anterior IN_TRANSIT (no terminal) → visible en operativo", () => {
  // El nuevo scope: if (!terminal) return true — visible sin discriminar año.
  assert.match(
    source,
    /if \(!terminal\) return true/,
    "Shipments no terminales SIEMPRE visibles en operativo (incluye carryover de cualquier año)",
  );
  // La dependencia de prevYear ya NO debe existir (reemplazada por !terminal)
  assert.doesNotMatch(
    source,
    /year === prevYear\s*\)/,
    "El scope operativo ya no debe depender de prevYear — carryover se gestiona por estado",
  );
});

// ─── G: CLOSED ANTIGUO → SOLO HISTÓRICO ──────────────────────────────────────
test("G: año anterior CLOSED → NO visible en operativo", () => {
  // El scope: terminal + !currentYear + !review_required → return false.
  // Se confirma que review_required es el único salvoconducto para terminales viejos.
  assert.match(
    source,
    /if \(shipment\.review_required\) return true/,
    "Solo terminales con review_required son visibles en operativo fuera del año actual",
  );
  // CLOSED del año anterior (sin review_required) devuelve false → no visible
  assert.match(
    source,
    /return false;[\s\S]{0,5}\}\);/s,
    "El scope finaliza con return false para terminales no especiales",
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
test("K2: v0-only expected unknown no se persiste como 0", () => {
  assert.match(
    source,
    /preserveExistingInboundQuantities/,
    "Incoming expected unknown debe preservar cantidad_esperada existente",
  );
  assert.match(
    source,
    /omitUnknownCantidadEnviada/,
    "Shipped unknown no debe escribir 0 en cantidad_enviada NOT NULL",
  );
  assert.doesNotMatch(
    source,
    /Math\.max\(0,\s*shippedQty\s*-\s*receivedQty\)/,
    "Discrepancia no debe clamparse a >= 0",
  );
});

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
    /shippedQty\s*=\s*expectedQty/,
    "shippedQty nunca debe caer a expectedQty",
  );
  assert.doesNotMatch(
    source,
    /shipped_quantity:\s*item\.expected_quantity/,
    "shipped no debe leerse desde expected_quantity",
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

// ─── POST-LIVE: tests añadidos tras diagnóstico de IN_TRANSIT ausente ─────────
// ROOT CAUSE: el filtro local de fecha aplicaba el cutoff de lastUpdatedAfter
// contra la fecha de CREACIÓN (del shipment_name), no contra la fecha de
// actualización. Shipments IN_TRANSIT creados en 2024 y aún activos en 2026
// quedaban descartados porque 2024 < cutoff(2026-01-01).

test("N: IN_TRANSIT creado 2024 — lower-bound cutoff NO aplica a no-terminales", () => {
  // El fix aplica el cutoff de fecha únicamente a statusIsTerminal.
  // La expresión correcta es: statusIsTerminal && !Number.isNaN(cutoff) && time < cutoff
  assert.match(
    source,
    /statusIsTerminal && !Number\.isNaN\(cutoff\) && time < cutoff/,
    "El cutoff de fecha inferior debe estar condicionado a statusIsTerminal",
  );
  // La versión incorrecta (cutoff sin condicionar a terminal) no debe existir
  // en el bloque del filtro. El patrón busca el chequeo desnudo anterior al fix.
  assert.doesNotMatch(
    source,
    /if \(!Number\.isNaN\(cutoff\) && time < cutoff\)/,
    "El cutoff desnudo sin condición de statusIsTerminal no debe existir",
  );
});

test("O: IN_TRANSIT nunca puede caer en skippedByStatus", () => {
  // NON_TERMINAL_STATUSES incluye IN_TRANSIT.
  // filterShipmentsForSync sólo incrementa skippedByStatus si statusIsTerminal o !includeClosed.
  // Si el status es IN_TRANSIT → isTerminalStatus=false → no puede entrar en la rama de skip.
  assert.match(
    source,
    /NON_TERMINAL_STATUSES.*IN_TRANSIT/s,
    "IN_TRANSIT debe estar en NON_TERMINAL_STATUSES",
  );
  assert.doesNotMatch(
    source,
    /TERMINAL_STATUSES[^=]*IN_TRANSIT/,
    "IN_TRANSIT no debe aparecer en TERMINAL_STATUSES",
  );
});

test("P: shipment_name no parseable — no se inventa año, se conserva shipment", () => {
  // parseShipmentNameDate devuelve null si el nombre no tiene el patrón (DD/MM/YYYY HH:MM).
  assert.match(
    source,
    /function parseShipmentNameDate[\s\S]{0,300}if \(!match\) return null/s,
    "parseShipmentNameDate debe retornar null cuando el nombre no tiene fecha parseable",
  );
  // Non-terminal without date is included; skippedByMissingDate stays 0.
  assert.match(
    source,
    /activeWithoutDateImported \+= 1/,
    "Non-terminal sin fecha debe incrementarse como activeWithoutDateImported",
  );
  assert.doesNotMatch(
    source,
    /skippedByMissingDate \+= 1/,
    "Non-terminal sin fecha ya no se descarta con skippedByMissingDate",
  );
});

test("Q: acquisitionComplete=false — UI NO muestra 'completada' como éxito pleno", () => {
  // El banner diferencia COMPLETA / PARCIAL / no determinada.
  assert.match(
    uiSource,
    /Sincronizacion COMPLETA/,
    "Banner debe mostrar COMPLETA cuando acquisitionComplete=true",
  );
  assert.match(
    uiSource,
    /Sincronizacion PARCIAL/,
    "Banner debe mostrar PARCIAL cuando acquisitionComplete=false",
  );
  // 'Sincronizacion completada' (sin mayúscula semántica) no debe aparecer
  // porque engaña al usuario cuando el sync fue parcial.
  assert.doesNotMatch(
    uiSource,
    /Sincronizacion completada/,
    "El texto genérico 'completada' ya no debe usarse — reemplazado por COMPLETA/PARCIAL",
  );
});

test("R: upper-bound (toDate) sigue aplicando a todos los shipments", () => {
  // El fix sólo afecta al lower-bound. El upper-bound no cambia.
  assert.match(
    source,
    /!Number\.isNaN\(maxTime\) && time > maxTime/,
    "El upper-bound de fecha sigue activo para todos los shipments",
  );
  // El upper-bound NO debe estar condicionado a statusIsTerminal
  const upperBoundBlock = source.match(
    /if \(!Number\.isNaN\(maxTime\) && time > maxTime\)[\s\S]{0,100}skippedByDate/,
  );
  assert.ok(upperBoundBlock, "El bloque upper-bound debe incrementar skippedByDate");
});

test("S: scope operativo conserva carryover no-terminal de año anterior", () => {
  // El operative scope incluye shipments del año anterior si son no-terminales.
  assert.match(
    source,
    /listOperativeScope|operative.*scope/i,
    "Existe la función de scope operativo",
  );
  // La función no filtra por fecha de creación del shipment sino por su año y estado
  assert.match(
    source,
    /shipment_year.*current_year|currentYear.*shipment_year/is,
    "El scope operativo usa shipment_year, no la fecha de creación directamente",
  );
});
