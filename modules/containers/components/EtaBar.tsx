import {
  isEstadoLogisticoPostTransitoResolved,
  labelEstadoLogisticoContenedor,
} from "@/modules/containers/constants/estadoContenedor";

export function EtaBar({
  fechaSalida,
  fechaEta,
  estadoLogistico,
  estadoStock,
}: {
  fechaSalida: string | null;
  fechaEta: string | null;
  estadoLogistico: string;
  estadoStock: string;
}) {
  if (isEstadoLogisticoPostTransitoResolved(estadoLogistico, estadoStock)) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-20 h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <div className="h-full w-full bg-slate-400 rounded-full" />
        </div>
        <span className="text-[11px] text-slate-400">
          {labelEstadoLogisticoContenedor(estadoLogistico)}
        </span>
      </div>
    );
  }
  if (!fechaEta) return <span className="text-[11px] text-slate-300">Sin ETA</span>;

  const now   = Date.now();
  const etaMs = new Date(fechaEta).getTime();
  const dias  = Math.round((etaMs - now) / 86_400_000);
  let pct = 0;
  if (fechaSalida) {
    const salMs = new Date(fechaSalida).getTime();
    const total = etaMs - salMs;
    if (total > 0) pct = Math.min(100, Math.round(((now - salMs) / total) * 100));
  }

  const barColor    = dias < 0 ? "bg-red-500" : dias < 7 ? "bg-red-400" : dias < 15 ? "bg-orange-400" : dias < 30 ? "bg-amber-400" : "bg-emerald-500";
  const labelColor  = dias < 0 ? "text-red-600" : dias < 7 ? "text-red-500" : dias < 15 ? "text-orange-500" : dias < 30 ? "text-amber-600" : "text-emerald-600";
  const label       = dias < 0 ? `RETRASADO ${Math.abs(dias)}d` : `ETA ${dias}d`;

  return (
    <div className="flex items-center gap-1.5">
      <div className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[11px] font-medium ${labelColor}`}>{label}</span>
    </div>
  );
}
