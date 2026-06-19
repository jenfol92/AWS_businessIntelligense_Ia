/**
 * Agrupa líneas de reposición en propuestas de contenedor (65 m³).
 * Regla: proveedores/fábricas a <= 400 km (o mismo puerto) pueden consolidarse.
 */

import {
  resolvePortDisplayName,
  resolveSupplierDistanceToPort,
} from "../repositories/plannerRepository";
import type {
  ContainerGroupExcludedProduct,
  ContainerGroupProduct,
  ContainerGroupStatus,
  ContainerOptimizationGroup,
  EnrichedAnnualPurchasePlanLine,
  PlanningProduct,
  RecommendedPortReason,
} from "../types/planner.types";

export const CONTAINER_CAPACITY_CBM = 65;
export const LOW_VOLUME_CBM = 35;
export const MAX_FACTORY_DISTANCE_KM = 400;

type SupplierMeta = {
  id: string;
  nombre: string | null;
  puerto_preferido: string | null;
  puerto_preferido_id: string | null;
};

type Candidate = {
  line: EnrichedAnnualPurchasePlanLine;
  product: PlanningProduct;
  supplier: SupplierMeta | null;
  consolidatable: boolean;
  preferredPortId: string | null;
  originPortId: string | null;
  distanceKmToPort: number | null;
};

function isConsolidatable(product: PlanningProduct): boolean {
  const lr = product.logisticsRestriction;
  if (!lr) return true;
  if (lr.allowsConsolidation === false) return false;
  if (lr.contieneBaterias) return false;
  if (lr.forzarEnvioSeparado) return false;
  if (lr.permiteConsolidacionMixta === false) return false;
  return true;
}

function exclusionReason(product: PlanningProduct): string {
  const lr = product.logisticsRestriction;
  if (lr?.contieneBaterias) return "Batería / mercancía peligrosa";
  if (lr?.forzarEnvioSeparado) return "Envío separado obligatorio";
  if (lr?.permiteConsolidacionMixta === false) return "No permite consolidación mixta";
  if (lr?.allowsConsolidation === false) return "Restricción logística";
  return "No consolidable";
}

/** Union-Find para agrupar proveedores cercanos o con mismo puerto. */
class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = this.parent.get(x)!;
    while (root !== this.parent.get(root)) {
      root = this.parent.get(root)!;
    }
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function suppliersCanCluster(a: Candidate, b: Candidate): boolean {
  const sa = a.supplier?.id;
  const sb = b.supplier?.id;
  if (!sa || !sb) return false;
  if (sa === sb) return true;

  const portA = a.preferredPortId ?? a.originPortId;
  const portB = b.preferredPortId ?? b.originPortId;
  if (portA && portB && portA === portB) return true;

  const distA = a.distanceKmToPort;
  const distB = b.distanceKmToPort;
  const sharedPort = a.originPortId && a.originPortId === b.originPortId ? a.originPortId : null;

  if (sharedPort && distA != null && distB != null) {
    if (distA <= MAX_FACTORY_DISTANCE_KM && distB <= MAX_FACTORY_DISTANCE_KM) {
      return true;
    }
  }

  if (portA && portB && distA != null && distB != null) {
    if (distA <= MAX_FACTORY_DISTANCE_KM && distB <= MAX_FACTORY_DISTANCE_KM) {
      return portA === portB;
    }
  }

  return false;
}

type RecommendedPortPick = {
  portId: string | null;
  portName: string;
  reason: RecommendedPortReason;
  requiresReview: boolean;
  warnings: string[];
};

function portKeyForMember(m: Candidate): string | null {
  if (m.preferredPortId) return m.preferredPortId;
  const name = m.line.supplierPreferredPortName;
  if (name && name !== "Puerto pendiente" && name !== "Puerto sin definir") {
    return `name:${name}`;
  }
  return null;
}

function portNameFromKey(
  key: string | null,
  portNames: Map<string, string>,
): string {
  if (!key) return "Puerto a revisar";
  if (key.startsWith("name:")) return key.slice(5);
  const resolved = resolvePortDisplayName(key, portNames);
  return resolved === "Puerto sin definir" ? "Puerto a revisar" : resolved;
}

function portIdFromFabricaRow(row: Record<string, unknown>): string | null {
  const raw = row.puerto_id;
  if (raw !== undefined && raw !== null && raw !== "") {
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  }
  return null;
}

function collectCandidatePortIds(
  members: Candidate[],
  puertosFabrica: Map<string, Record<string, unknown>[]>,
): Set<string> {
  const ids = new Set<string>();
  for (const m of members) {
    if (m.preferredPortId) ids.add(m.preferredPortId);
    const sid = m.supplier?.id;
    if (!sid) continue;
    for (const row of puertosFabrica.get(sid) ?? []) {
      const pid = portIdFromFabricaRow(row);
      if (pid) ids.add(pid);
    }
  }
  return ids;
}

/**
 * Puerto óptimo del grupo (no confundir con puerto preferido de cada fábrica).
 * P1: mayoría comparte puerto preferido → P2: mayor CBM si fábricas cercanas →
 * P3: menor distancia media ponderada por CBM → P4: revisión manual.
 */
function pickRecommendedPort(
  members: Candidate[],
  portNames: Map<string, string>,
  puertosFabrica: Map<string, Record<string, unknown>[]>,
): RecommendedPortPick {
  const warnings: string[] = [];
  const totalMembers = members.length;

  const prefPortCbm = new Map<string, number>();
  const prefPortCount = new Map<string, number>();
  let membersWithPref = 0;

  for (const m of members) {
    const pid = portKeyForMember(m);
    if (!pid) continue;
    membersWithPref += 1;
    const cbm = m.line.cbmTotal ?? 0;
    prefPortCbm.set(pid, (prefPortCbm.get(pid) ?? 0) + cbm);
    prefPortCount.set(pid, (prefPortCount.get(pid) ?? 0) + 1);
  }

  if (prefPortCount.size > 0) {
    let topPort: string | null = null;
    let topCount = 0;
    for (const [pid, count] of Array.from(prefPortCount.entries())) {
      if (count > topCount) {
        topCount = count;
        topPort = pid;
      }
    }
    const allSharePreferred =
      prefPortCount.size === 1 && membersWithPref === totalMembers;
    const majorityShare = topCount > totalMembers / 2;

    if (topPort && (allSharePreferred || majorityShare)) {
      const portName = portNameFromKey(topPort, portNames);
      const unresolved = portName === "Puerto a revisar";
      return {
        portId: topPort.startsWith("name:") ? null : topPort,
        portName: unresolved ? "Puerto a revisar" : portName,
        reason: "Puerto compartido por las fábricas",
        requiresReview: unresolved,
        warnings: unresolved ? ["Puerto preferido sin nombre resuelto"] : [],
      };
    }
  }

  if (prefPortCbm.size > 1) {
    let bestPort: string | null = null;
    let bestCbm = -1;
    for (const [pid, cbm] of Array.from(prefPortCbm.entries())) {
      if (cbm > bestCbm) {
        bestCbm = cbm;
        bestPort = pid;
      }
    }
    if (bestPort) {
      const portName = portNameFromKey(bestPort, portNames);
      const unresolved = portName === "Puerto a revisar";
      return {
        portId: bestPort.startsWith("name:") ? null : bestPort,
        portName: unresolved ? "Puerto a revisar" : portName,
        reason: "Puerto mayoritario por CBM",
        requiresReview: unresolved,
        warnings: unresolved ? ["Puerto mayoritario sin nombre resuelto"] : [],
      };
    }
  }

  const candidatePorts = collectCandidatePortIds(members, puertosFabrica);
  let bestPortP3: string | null = null;
  let bestWeightedDist = Infinity;
  let hasWeightedDistance = false;

  for (const portId of Array.from(candidatePorts)) {
    let weightedSum = 0;
    let totalCbm = 0;
    for (const m of members) {
      const cbm = m.line.cbmTotal ?? 0;
      const dist = resolveSupplierDistanceToPort(
        m.supplier?.id ?? null,
        portId,
        puertosFabrica,
        m.preferredPortId,
        m.distanceKmToPort,
      );
      if (dist != null) {
        hasWeightedDistance = true;
        weightedSum += cbm * dist;
        totalCbm += cbm;
      }
    }
    if (totalCbm > 0) {
      const avg = weightedSum / totalCbm;
      if (avg < bestWeightedDist) {
        bestWeightedDist = avg;
        bestPortP3 = portId;
      }
    }
  }

  if (hasWeightedDistance && bestPortP3) {
    const portName = resolvePortDisplayName(bestPortP3, portNames);
    const unresolved = portName === "Puerto sin definir";
    return {
      portId: unresolved ? null : bestPortP3,
      portName: unresolved ? "Puerto a revisar" : portName,
      reason: "Menor distancia media ponderada",
      requiresReview: unresolved,
      warnings: unresolved ? ["Puerto por distancia sin nombre resuelto"] : [],
    };
  }

  warnings.push("No se pudo calcular puerto óptimo para el grupo");
  return {
    portId: null,
    portName: "Puerto a revisar",
    reason: "Requiere revisión manual",
    requiresReview: true,
    warnings,
  };
}

function statusFromCbm(cbm: number, hasReviewWarnings: boolean): {
  status: ContainerGroupStatus;
  statusLabel: string;
} {
  if (hasReviewWarnings) {
    return { status: "REVIEW_REQUIRED", statusLabel: "Requiere revisión" };
  }
  if (cbm > CONTAINER_CAPACITY_CBM) {
    return { status: "EXCEEDS", statusLabel: "Excede 65 m³" };
  }
  if (cbm < LOW_VOLUME_CBM) {
    return { status: "LOW_VOLUME", statusLabel: "Contenedor bajo" };
  }
  return { status: "GOOD_CANDIDATE", statusLabel: "Buen candidato" };
}

function inclusionReason(
  member: Candidate,
  recommendedPortId: string | null,
): string {
  const pref = member.preferredPortId;
  const origin = member.originPortId;
  if (pref && recommendedPortId && pref === recommendedPortId) {
    return "Mismo puerto preferido";
  }
  if (origin && recommendedPortId && origin === recommendedPortId) {
    return "Mismo puerto de salida";
  }
  if (member.distanceKmToPort != null && member.distanceKmToPort <= MAX_FACTORY_DISTANCE_KM) {
    return `Fábrica a ${Math.round(member.distanceKmToPort)} km del puerto del grupo`;
  }
  const portName = recommendedPortId ? "puerto del grupo" : "agrupación";
  return `Mayor CBM consolidado en ${portName}`;
}

function buildGroupProducts(
  members: Candidate[],
  recommendedPortId: string | null,
  portNames: Map<string, string>,
  puertosFabrica: Map<string, Record<string, unknown>[]>,
): ContainerGroupProduct[] {
  return members.map((m) => {
    const factoryPortName =
      m.line.supplierPreferredPortName ||
      resolvePortDisplayName(m.preferredPortId, portNames);
    const distToRecommended = recommendedPortId
      ? resolveSupplierDistanceToPort(
          m.supplier?.id ?? null,
          recommendedPortId,
          puertosFabrica,
          m.preferredPortId,
          m.distanceKmToPort,
        )
      : null;

    return {
      productId: m.line.productId,
      sku: m.line.sku,
      productName: m.line.productName ?? m.line.sku,
      recommendedUnits: m.line.recommendedOrderUnits,
      cbmTotal: m.line.cbmTotal ?? 0,
      weightKgTotal: m.line.weightKgTotal,
      supplierId: m.line.supplierId ?? null,
      supplierName: m.line.supplierName ?? null,
      supplierPreferredPortId: m.line.supplierPreferredPortId ?? m.preferredPortId,
      supplierPreferredPortName:
        factoryPortName === "Puerto sin definir" ? "Puerto pendiente" : factoryPortName,
      distanceKmToRecommendedPort: distToRecommended,
      inclusionReason: inclusionReason(m, recommendedPortId),
      recommendationReasonLabel: m.line.recommendationReasonLabel,
      readableTiming: m.line.readableTiming,
      agentId: m.line.agentId ?? null,
    };
  });
}

export function buildContainerOptimizationGroups(args: {
  lines: EnrichedAnnualPurchasePlanLine[];
  productsById: Map<string, PlanningProduct>;
  suppliersById: Map<string, SupplierMeta>;
  portNames: Map<string, string>;
  puertosFabrica: Map<string, Record<string, unknown>[]>;
}): ContainerOptimizationGroup[] {
  const { lines, productsById, suppliersById, portNames, puertosFabrica } = args;

  const candidates: Candidate[] = lines.map((line) => {
    const product = productsById.get(line.productId);
    const supplier = line.supplierId ? suppliersById.get(line.supplierId) ?? null : null;
    const preferredPortId = supplier?.puerto_preferido_id ?? null;
    return {
      line,
      product: product!,
      supplier,
      consolidatable: product ? isConsolidatable(product) : false,
      preferredPortId,
      originPortId: line.originPortId ?? product?.originPortId ?? preferredPortId,
      distanceKmToPort: product?.originPortDistanceKmRoad ?? null,
    };
  }).filter((c) => c.product);

  const groups: ContainerOptimizationGroup[] = [];
  let groupIndex = 0;

  const nonConsolidatable = candidates.filter((c) => !c.consolidatable);
  for (const nc of nonConsolidatable) {
    const cbm = nc.line.cbmTotal ?? 0;
    const port = pickRecommendedPort([nc], portNames, puertosFabrica);
    const agentId = nc.line.agentId ?? null;
    groups.push({
      groupId: `solo-${nc.line.productId}`,
      recommendedPortId: port.portId,
      recommendedPortName: port.portName,
      recommendedPortReason: port.reason,
      status: "NOT_CONSOLIDABLE",
      statusLabel: "No consolidable",
      canCreateDraftOrder: true,
      cbmTotal: cbm,
      containerCapacityCbm: CONTAINER_CAPACITY_CBM,
      fillRate: cbm / CONTAINER_CAPACITY_CBM,
      capitalRequired: nc.line.purchaseCapitalRequired ?? 0,
      totalProducts: 1,
      totalSuppliers: nc.supplier ? 1 : 0,
      sharedAgentId: agentId,
      agentContact: nc.line.agentContact,
      warnings: [exclusionReason(nc.product)],
      explanation: `Producto con restricción logística. Pedido individual recomendado.`,
      products: buildGroupProducts([nc], port.portId, portNames, puertosFabrica),
      excludedProducts: [],
    });
  }

  const consolidatable = candidates.filter((c) => c.consolidatable);
  const uf = new UnionFind();
  const supplierIds = Array.from(
    new Set(consolidatable.map((c) => c.supplier?.id).filter((id): id is string => Boolean(id))),
  );
  for (const id of supplierIds) uf.find(id);

  for (let i = 0; i < consolidatable.length; i++) {
    for (let j = i + 1; j < consolidatable.length; j++) {
      const a = consolidatable[i];
      const b = consolidatable[j];
      if (a.supplier?.id && b.supplier?.id && suppliersCanCluster(a, b)) {
        uf.union(a.supplier.id, b.supplier.id);
      }
    }
  }

  const clusterMap = new Map<string, Candidate[]>();
  for (const c of consolidatable) {
    const sid = c.supplier?.id ?? `orphan-${c.line.productId}`;
    const root = c.supplier?.id ? uf.find(c.supplier.id) : sid;
    const arr = clusterMap.get(root) ?? [];
    arr.push(c);
    clusterMap.set(root, arr);
  }

  for (const [, clusterMembers] of Array.from(clusterMap.entries())) {
    let members = [...clusterMembers];
    groupIndex += 1;
    const port = pickRecommendedPort(members, portNames, puertosFabrica);
    const warnings = [...port.warnings];

    const unknownDist =
      port.portId != null &&
      members.some(
        (m) =>
          resolveSupplierDistanceToPort(
            m.supplier?.id ?? null,
            port.portId,
            puertosFabrica,
            m.preferredPortId,
            m.distanceKmToPort,
          ) == null,
      );
    if (unknownDist && members.length > 1) {
      warnings.push("Distancia fábrica-puerto no informada: requiere validación manual");
    }

    const agentIds = new Set(members.map((m) => m.line.agentId).filter(Boolean));
    let sharedAgentId: string | null = null;
    let agentContact = "Sin agente";
    if (agentIds.size === 1) {
      sharedAgentId = Array.from(agentIds)[0] ?? null;
      agentContact = members[0]?.line.agentContact ?? "Sin agente";
    } else if (agentIds.size > 1) {
      warnings.push("El grupo contiene productos de distintos agentes");
      agentContact = "Varios agentes";
    } else {
      agentContact = members[0]?.line.agentContact ?? "Sin agente";
    }

    const cbmTotal = members.reduce((s, m) => s + (m.line.cbmTotal ?? 0), 0);
    const capitalRequired = members.reduce(
      (s, m) => s + (m.line.purchaseCapitalRequired ?? 0),
      0,
    );
    const supplierSet = new Set(members.map((m) => m.supplier?.id).filter(Boolean));

    const hasReview =
      port.requiresReview || warnings.length > 0 || (unknownDist && members.length > 1);
    const { status, statusLabel } = statusFromCbm(cbmTotal, hasReview);

    const excludedProducts: ContainerGroupExcludedProduct[] = [];
    if (cbmTotal > CONTAINER_CAPACITY_CBM) {
      let running = 0;
      const sorted = [...members].sort(
        (a, b) => (b.line.cbmTotal ?? 0) - (a.line.cbmTotal ?? 0),
      );
      const included: Candidate[] = [];
      for (const m of sorted) {
        const cbm = m.line.cbmTotal ?? 0;
        if (running + cbm <= CONTAINER_CAPACITY_CBM) {
          included.push(m);
          running += cbm;
        } else {
          excludedProducts.push({
            productId: m.line.productId,
            sku: m.line.sku,
            productName: m.line.productName ?? m.line.sku,
            reason: "Excede capacidad de 65 m³ en este grupo",
          });
        }
      }
      if (included.length > 0 && excludedProducts.length > 0) {
        members = included;
      }
    }

    const finalCbm = members.reduce((s, m) => s + (m.line.cbmTotal ?? 0), 0);
    const fillRate = finalCbm / CONTAINER_CAPACITY_CBM;

    let explanation = `${members.length} producto(s) de ${supplierSet.size} proveedor(es) `;
    explanation += `consolidables por proximidad (≤ ${MAX_FACTORY_DISTANCE_KM} km o mismo puerto). `;
    explanation += `Puerto recomendado: ${port.portName}. Motivo: ${port.reason}.`;

    groups.push({
      groupId: `grp-${groupIndex}-${port.portId ?? "pending"}`,
      recommendedPortId: port.portId,
      recommendedPortName: port.portName,
      recommendedPortReason: port.reason,
      status: cbmTotal > CONTAINER_CAPACITY_CBM && excludedProducts.length === 0 ? "EXCEEDS" : status,
      statusLabel:
        cbmTotal > CONTAINER_CAPACITY_CBM && excludedProducts.length === 0
          ? "Excede 65 m³"
          : statusLabel,
      canCreateDraftOrder: members.length > 0 && !port.requiresReview,
      cbmTotal: finalCbm,
      containerCapacityCbm: CONTAINER_CAPACITY_CBM,
      fillRate,
      capitalRequired,
      totalProducts: members.length,
      totalSuppliers: supplierSet.size,
      sharedAgentId,
      agentContact,
      warnings,
      explanation,
      products: buildGroupProducts(members, port.portId, portNames, puertosFabrica),
      excludedProducts,
    });
  }

  return groups.sort((a, b) => b.cbmTotal - a.cbmTotal);
}
