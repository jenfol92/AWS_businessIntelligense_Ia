"use client";

import { Badge, Button, Card, Flex, ProgressBar, Text } from "@tremor/react";
import { Anchor, ChevronDown, ChevronUp, Package, ShoppingCart } from "lucide-react";
import { useState } from "react";
import type { ContainerOptimizationGroup } from "../types/planner.types";

function formatEur(n: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
}

function formatNum(n: number, d = 1): string {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

function statusColor(status: ContainerOptimizationGroup["status"]) {
  switch (status) {
    case "GOOD_CANDIDATE":
      return "emerald";
    case "LOW_VOLUME":
      return "amber";
    case "EXCEEDS":
      return "rose";
    case "REVIEW_REQUIRED":
      return "amber";
    default:
      return "gray";
  }
}

export type ContainerOptimizationCardProps = {
  group: ContainerOptimizationGroup;
  onReview?: (group: ContainerOptimizationGroup) => void;
  /** Añade todos los productos del grupo al basket (no abre modal). */
  onAddGroupToBasket?: (group: ContainerOptimizationGroup) => void;
  isProductInBasket?: (productId: string) => boolean;
};

export default function ContainerOptimizationCard({
  group,
  onReview,
  onAddGroupToBasket,
  isProductInBasket,
}: ContainerOptimizationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const fillPct = Math.min(100, Math.round(group.fillRate * 100));

  return (
    <Card className="ring-1 ring-slate-200 bg-white">
      <Flex justifyContent="between" alignItems="start" className="gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="rounded-lg bg-slate-100 p-2.5 shrink-0">
            <Anchor className="h-6 w-6 text-slate-700" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-900">
              Puerto recomendado: {group.recommendedPortName}
            </p>
            <Text className="text-xs text-slate-600 mt-0.5">
              Motivo: {group.recommendedPortReason}
            </Text>
            <Flex className="mt-1 flex-wrap gap-2" justifyContent="start">
              <Badge color={statusColor(group.status)} size="sm">
                {group.statusLabel}
              </Badge>
              <Text className="text-sm text-slate-600">
                {formatNum(group.cbmTotal, 2)} / {group.containerCapacityCbm} m³
              </Text>
            </Flex>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold text-slate-900">{fillPct}%</p>
          <Text className="text-xs">llenado</Text>
        </div>
      </Flex>

      <div className="mt-4">
        <ProgressBar value={fillPct} color={statusColor(group.status)} className="h-2.5" />
        {group.status === "LOW_VOLUME" && (
          <Text className="mt-1 text-sm text-amber-800">
            Contenedor bajo: valorar esperar o agrupar más productos.
          </Text>
        )}
        {group.status === "EXCEEDS" && (
          <Text className="mt-1 text-sm text-rose-800">
            Excede 65 m³: al guardar el borrador podrás dividir el pedido.
          </Text>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <Text className="text-xs text-slate-500">Capital est.</Text>
          <p className="font-semibold text-slate-800">{formatEur(group.capitalRequired)}</p>
        </div>
        <div>
          <Text className="text-xs text-slate-500">Productos</Text>
          <p className="font-semibold text-slate-800">{group.totalProducts}</p>
        </div>
        <div>
          <Text className="text-xs text-slate-500">Proveedores</Text>
          <p className="font-semibold text-slate-800">{group.totalSuppliers}</p>
        </div>
        <div>
          <Text className="text-xs text-slate-500">Agente</Text>
          <p className="font-semibold text-slate-800 truncate" title={group.agentContact}>
            {group.agentContact}
          </p>
        </div>
      </div>

      {group.warnings.length > 0 && (
        <ul className="mt-3 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-amber-900 list-disc list-inside">
          {group.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="xs"
          variant="secondary"
          icon={expanded ? ChevronUp : ChevronDown}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Ocultar productos" : `Ver ${group.products.length} productos`}
        </Button>
        <Button size="xs" variant="light" onClick={() => setShowCalc(!showCalc)}>
          {showCalc ? "Ocultar cálculo" : "Ver detalle de cálculo"}
        </Button>
        {onReview && (
          <Button size="xs" variant="secondary" onClick={() => onReview(group)}>
            Revisar grupo
          </Button>
        )}
        {group.status === "NOT_CONSOLIDABLE" ? (
          <p className="text-xs text-rose-800 font-medium w-full">
            No crear orden agrupada sin revisión
          </p>
        ) : onAddGroupToBasket ? (
          <Button
            size="xs"
            variant="primary"
            icon={ShoppingCart}
            onClick={() => onAddGroupToBasket(group)}
          >
            Añadir grupo a orden
          </Button>
        ) : null}
      </div>

      {showCalc && (
        <p className="mt-3 text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
          {group.explanation}
        </p>
      )}

      {expanded && (
        <div className="mt-4 space-y-3">
          <div>
            <Text className="text-xs font-semibold uppercase text-slate-500 mb-2">
              Incluidos en el grupo
            </Text>
            <div className="space-y-2">
              {group.products.map((p) => (
                <div
                  key={p.productId}
                  className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm"
                >
                  <Flex justifyContent="between" className="gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{p.productName}</p>
                      <p className="text-xs text-slate-500 font-mono">{p.sku}</p>
                    </div>
                    <div className="text-right text-xs text-slate-600 shrink-0">
                      <p>{p.recommendedUnits} uds · {formatNum(p.cbmTotal, 2)} m³</p>
                    </div>
                  </Flex>
                  <p className="text-xs text-slate-500 mt-1">
                    {p.supplierName ?? "—"} · Puerto fábrica: {p.supplierPreferredPortName}
                    {p.distanceKmToRecommendedPort != null
                      ? ` · ${Math.round(p.distanceKmToRecommendedPort)} km al puerto recomendado`
                      : ""}
                  </p>
                  <p className="text-xs text-blue-800 mt-0.5">{p.inclusionReason}</p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {p.recommendationReasonLabel} — {p.readableTiming}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {group.excludedProducts.length > 0 && (
            <div>
              <Text className="text-xs font-semibold uppercase text-rose-700 mb-2">
                Excluidos del grupo
              </Text>
              <ul className="space-y-1 text-sm text-rose-900">
                {group.excludedProducts.map((e) => (
                  <li key={e.productId} className="flex gap-2">
                    <Package className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>{e.productName}</strong> ({e.sku}): {e.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
