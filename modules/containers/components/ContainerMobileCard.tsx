import { ChevronDown, ChevronRight, MapPin, Pencil } from "lucide-react";

import { ContainerDetailPanel } from "@/modules/containers/components/ContainerDetailPanel";
import { ContenedorEstadosBadges } from "@/modules/containers/components/ContainerEstadosBadges";
import { EtaBar } from "@/modules/containers/components/EtaBar";
import { TIPO_CONTENEDOR_LABELS } from "@/modules/containers/constants/estadoContenedor";
import type { ContenedorRow } from "@/modules/containers/types/containerUiTypes";
import { resolveContainerEstados } from "@/modules/containers/utils/resolveContainerEstados";
import { parseDelayFromNotes } from "@/modules/containers/utils/parseDelayFromNotes";
import { ResponsiveDataCard } from "@/shared/ui/ResponsiveDataCard";

export type ContainerMobileCardProps = {
  contenedor: ContenedorRow;
  expanded: boolean;
  onToggle: () => void;
  onFindTeu: () => void;
  hasId: boolean;
  isIsoFormat: boolean;
  onChanged: () => void;
  onVerOrden: (id: string) => void;
  onEdit?: () => void;
};

function resolveEstadosContenedor(c: Pick<
  ContenedorRow,
  "estado" | "estado_logistico" | "estado_stock" | "estado_costes" | "tipo_contenedor"
>) {
  return resolveContainerEstados(c);
}

function fmtShortDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" });
}

export function ContainerMobileCard({
  contenedor,
  expanded,
  onToggle,
  onFindTeu,
  hasId,
  isIsoFormat,
  onChanged,
  onVerOrden,
  onEdit,
}: ContainerMobileCardProps) {
  const retraso = parseDelayFromNotes(contenedor.notas);

  return (
    <div className={expanded ? "rounded-xl ring-2 ring-blue-100" : undefined}>
      <ResponsiveDataCard
        title={
          <span className="font-mono text-xs">{contenedor.identificador_embarque}</span>
        }
        subtitle={contenedor.notas?.split("\n")[0]}
        badges={<ContenedorEstadosBadges contenedor={contenedor} />}
        fields={[
          {
            label: "Destino",
            value: contenedor.destino_label ?? contenedor.puerto_llegada ?? "Sin destino definido",
            className: "col-span-2",
          },
          {
            label: "Ruta",
            value: (
              <>
                {contenedor.puerto_salida ?? "—"} → {contenedor.puerto_llegada ?? "—"}
              </>
            ),
            className: "col-span-2",
          },
          {
            label: "Tipo",
            value:
              TIPO_CONTENEDOR_LABELS[
                resolveEstadosContenedor(contenedor).tipo_contenedor
              ] ?? contenedor.tipo_contenedor?.toUpperCase() ?? "—",
          },
          { label: "Transitario", value: contenedor.transitario ?? "—" },
          {
            label: "Agente",
            value:
              (contenedor.ordenes_count ?? 0) === 0
                ? "Sin orden"
                : contenedor.agente_contacto ?? "Sin agente",
          },
          { label: "Órdenes", value: contenedor.ordenes_count ?? 0 },
          {
            label: "Coste EUR",
            value: `€${Number(contenedor.coste_total_eur ?? 0).toLocaleString("es-ES", { maximumFractionDigits: 0 })}`,
          },
          { label: "Salida", value: fmtShortDate(contenedor.fecha_salida) },
          { label: "ETA", value: fmtShortDate(contenedor.fecha_eta_estimada) },
        ]}
        footer={
          retraso ? (
            <span className="text-red-600">
              Retraso de {retraso.dias}d
              {retraso.motivo && retraso.motivo !== "—"
                ? `: ${retraso.motivo.slice(0, 60)}${retraso.motivo.length > 60 ? "…" : ""}`
                : ""}
            </span>
          ) : (
            <EtaBar
              fechaSalida={contenedor.fecha_salida}
              fechaEta={contenedor.fecha_eta_estimada}
              estadoLogistico={resolveEstadosContenedor(contenedor).estado_logistico}
              estadoStock={resolveEstadosContenedor(contenedor).estado_stock}
            />
          )
        }
        actions={
          <>
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Pencil className="h-4 w-4" />
                Editar
              </button>
            ) : null}
            {hasId ? (
              <button
                type="button"
                onClick={onFindTeu}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
              >
                <MapPin className="h-4 w-4" />
                FindTEU
              </button>
            ) : (
              <span className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-300">
                <MapPin className="h-4 w-4" />
                Sin ID
              </span>
            )}
            {!isIsoFormat && hasId ? (
              <span className="self-center text-[10px] text-amber-500">Número no estándar</span>
            ) : null}
            <button
              type="button"
              onClick={onToggle}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {expanded ? (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Ocultar detalle
                </>
              ) : (
                <>
                  <ChevronRight className="h-4 w-4" />
                  Ver detalle
                </>
              )}
            </button>
          </>
        }
      />
      {expanded ? (
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <ContainerDetailPanel
            contenedorId={contenedor.id}
            onChanged={onChanged}
            onVerOrden={onVerOrden}
          />
        </div>
      ) : null}
    </div>
  );
}
