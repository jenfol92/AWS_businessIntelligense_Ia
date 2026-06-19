import type {
  PlanningProduct,
  PortPurchaseGroup,
  PortPurchasePlan,
} from "../types/planner.types";

const UNKNOWN_PORT_KEY = "UNKNOWN_PORT";

const MAX_ROAD_KM = 400;

const WARN_MISSING_DISTANCE =
  "Distancia no informada: requiere validación manual.";
const WARN_MULTI_AGENT =
  "Distinto agente: no consolidar automáticamente.";
const WARN_DISTANCE_OVER =
  "Distancia a puerto superior a 400 km.";

function portGroupKey(originPortId: string | null | undefined): string {
  return originPortId ?? UNKNOWN_PORT_KEY;
}

function isSeparatedByLogistics(product: PlanningProduct): boolean {
  const lr = product.logisticsRestriction;
  if (!lr) return false;

  return Boolean(
    lr.contieneBaterias === true ||
      lr.forzarEnvioSeparado === true ||
      lr.permiteConsolidacionMixta === false ||
      lr.allowsConsolidation === false,
  );
}

function normalizeAgentId(product: PlanningProduct): string | null {
  const v = product.agentId;
  if (v === undefined || v === null || v === "") return null;
  return v;
}

function agentsUniformAmongConsolidable(
  consolidable: PlanningProduct[],
): boolean {
  const ids = new Set(consolidable.map(normalizeAgentId));
  return ids.size <= 1;
}

function roadDistanceInformed(
  product: PlanningProduct,
): product is PlanningProduct & { originPortDistanceKmRoad: number } {
  const d = product.originPortDistanceKmRoad;
  return d !== undefined && d !== null && Number.isFinite(d);
}

function groupHasMissingRoadDistanceAmongConsolidable(
  consolidable: PlanningProduct[],
): boolean {
  return consolidable.some((p) => !roadDistanceInformed(p));
}

function groupHasRoadOverLimit(products: PlanningProduct[]): boolean {
  return products.some(
    (p) => roadDistanceInformed(p) && p.originPortDistanceKmRoad > MAX_ROAD_KM,
  );
}

function buildSeparatedSuffix(separated: PlanningProduct[]): string {
  if (separated.length === 0) return "";
  const withBatteries = separated.filter(
    (p) => p.logisticsRestriction?.contieneBaterias === true,
  ).length;
  if (withBatteries > 0) {
    return ` Hay ${separated.length} producto(s) separados por restricción logística (${withBatteries} con baterías).`;
  }
  return ` Hay ${separated.length} producto(s) separados por restricción logística.`;
}

function buildWarnings(args: {
  products: PlanningProduct[];
  consolidable: PlanningProduct[];
}): string[] {
  const warnings: string[] = [];
  const { products, consolidable } = args;

  if (groupHasMissingRoadDistanceAmongConsolidable(consolidable)) {
    warnings.push(WARN_MISSING_DISTANCE);
  }

  if (consolidable.length >= 2 && !agentsUniformAmongConsolidable(consolidable)) {
    warnings.push(WARN_MULTI_AGENT);
  }

  if (groupHasRoadOverLimit(products)) {
    warnings.push(WARN_DISTANCE_OVER);
  }

  return warnings;
}

function computeCanConsolidate(args: {
  consolidable: PlanningProduct[];
  originKey: string;
  products: PlanningProduct[];
}): boolean {
  const { consolidable, originKey, products } = args;

  if (consolidable.length < 2) return false;
  if (originKey === UNKNOWN_PORT_KEY) return false;
  if (!agentsUniformAmongConsolidable(consolidable)) return false;
  if (groupHasRoadOverLimit(products)) return false;

  return true;
}

function computeConsolidationStatus(args: {
  canConsolidate: boolean;
  warnings: string[];
}): PortPurchaseGroup["consolidationStatus"] {
  const { canConsolidate, warnings } = args;
  if (canConsolidate && warnings.length === 0) return "SUGGESTED";
  if (canConsolidate && warnings.length > 0) return "REVIEW";
  return "BLOCKED";
}

function buildReason(args: {
  status: PortPurchaseGroup["consolidationStatus"];
  separated: PlanningProduct[];
  consolidableCount: number;
}): string {
  const { status, separated, consolidableCount } = args;

  let head: string;
  if (status === "SUGGESTED") {
    head = "Consolidación marítima sugerida";
  } else if (status === "REVIEW") {
    head = "Revisión manual requerida";
  } else {
    if (consolidableCount < 2) {
      head = "Consolidación bloqueada: se requieren al menos dos productos consolidables.";
    } else {
      head = "Consolidación bloqueada";
    }
  }

  return head + buildSeparatedSuffix(separated);
}

function buildPortGroup(
  originKey: string,
  products: PlanningProduct[],
): PortPurchaseGroup {
  const separatedProducts = products.filter(isSeparatedByLogistics);
  const consolidableProducts = products.filter(
    (p) => !isSeparatedByLogistics(p),
  );

  const warnings = buildWarnings({
    products,
    consolidable: consolidableProducts,
  });

  const canConsolidate = computeCanConsolidate({
    consolidable: consolidableProducts,
    originKey,
    products,
  });

  const consolidationStatus = computeConsolidationStatus({
    canConsolidate,
    warnings,
  });

  const reason = buildReason({
    status: consolidationStatus,
    separated: separatedProducts,
    consolidableCount: consolidableProducts.length,
  });

  return {
    originPortId: originKey,
    products,
    consolidableProducts,
    separatedProducts,
    canConsolidate,
    consolidationStatus,
    consolidationWarnings: [...warnings],
    reason,
  };
}

export function buildPortPurchasePlan(
  products: PlanningProduct[],
): PortPurchasePlan {
  const byPort = new Map<string, PlanningProduct[]>();

  for (const product of products) {
    const key = portGroupKey(product.originPortId);
    const existing = byPort.get(key);
    if (existing) {
      existing.push(product);
    } else {
      byPort.set(key, [product]);
    }
  }

  const portGroups: PortPurchaseGroup[] = Array.from(byPort.entries()).map(
    ([originKey, groupProducts]) => buildPortGroup(originKey, groupProducts),
  );

  return { portGroups };
}
