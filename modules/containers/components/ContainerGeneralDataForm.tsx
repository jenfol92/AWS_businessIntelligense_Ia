"use client";

import { TIPO_CONTENEDOR_LABELS } from "@/modules/containers/constants/estadoContenedor";
import type { ContainerGeneralFormValues } from "@/modules/containers/hooks/useContainerGeneralForm";

export type ContainerGeneralDataFormProps = {
  values: ContainerGeneralFormValues;
  onChange: (patch: Partial<ContainerGeneralFormValues>) => void;
};

export function ContainerGeneralDataForm({
  values,
  onChange,
}: ContainerGeneralDataFormProps) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">
        Datos generales
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Nº embarque / BL</label>
          <input
            type="text"
            value={values.identificador_embarque}
            onChange={(e) => onChange({ identificador_embarque: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Tipo</label>
          <select
            value={values.tipo_contenedor}
            onChange={(e) => onChange({ tipo_contenedor: e.target.value as "propio" | "amazon_agl" })}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="propio">{TIPO_CONTENEDOR_LABELS.propio}</option>
            <option value="amazon_agl">{TIPO_CONTENEDOR_LABELS.amazon_agl}</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Transitario</label>
          <input
            type="text"
            value={values.transitario}
            onChange={(e) => onChange({ transitario: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Puerto salida</label>
          <input
            type="text"
            value={values.puerto_salida}
            onChange={(e) => onChange({ puerto_salida: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Puerto llegada</label>
          <input
            type="text"
            value={values.puerto_llegada}
            onChange={(e) => onChange({ puerto_llegada: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Fecha salida (ETD)</label>
          <input
            type="date"
            value={values.fecha_salida}
            onChange={(e) => onChange({ fecha_salida: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-slate-400 block mb-0.5">ETA llegada</label>
          <input
            type="date"
            value={values.fecha_eta_estimada}
            onChange={(e) => onChange({ fecha_eta_estimada: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Notas</label>
          <textarea
            value={values.notas}
            onChange={(e) => onChange({ notas: e.target.value })}
            rows={2}
            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  );
}
