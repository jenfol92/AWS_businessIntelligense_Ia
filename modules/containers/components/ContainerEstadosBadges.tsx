import {
  ESTADO_COSTES_BADGE,
  ESTADO_LOGISTICO_BADGE,
  ESTADO_STOCK_BADGE,
  labelEstadoCostesContenedor,
  labelEstadoLogisticoContenedor,
  labelEstadoStockContenedor,
} from "@/modules/containers/constants/estadoContenedor";
import type { ContenedorRow } from "@/modules/containers/types/containerUiTypes";
import { resolveContainerEstados } from "@/modules/containers/utils/resolveContainerEstados";

function EstadoAxisBadge({
  label,
  cfg,
  text,
}: {
  label: string;
  cfg: { bg: string; text: string };
  text: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}
      title={`${label}: ${text}`}
    >
      <span className="opacity-70">{label}:</span> {text}
    </span>
  );
}

export function ContenedorEstadosBadges({
  contenedor,
}: {
  contenedor: Pick<
    ContenedorRow,
    "estado" | "estado_logistico" | "estado_stock" | "estado_costes" | "tipo_contenedor"
  >;
}) {
  const estados = resolveContainerEstados(contenedor);
  return (
    <div className="flex flex-wrap gap-1">
      <EstadoAxisBadge
        label="Logístico"
        cfg={ESTADO_LOGISTICO_BADGE[estados.estado_logistico]}
        text={labelEstadoLogisticoContenedor(estados.estado_logistico)}
      />
      <EstadoAxisBadge
        label="Stock"
        cfg={ESTADO_STOCK_BADGE[estados.estado_stock]}
        text={labelEstadoStockContenedor(estados.estado_stock)}
      />
      <EstadoAxisBadge
        label="Costes"
        cfg={ESTADO_COSTES_BADGE[estados.estado_costes]}
        text={labelEstadoCostesContenedor(estados.estado_costes)}
      />
    </div>
  );
}
