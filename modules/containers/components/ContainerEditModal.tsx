"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, Save, X as XIcon } from "lucide-react";

import { fetchContainerDetail } from "@/modules/containers/api/containerClient";
import { ContainerGeneralDataForm } from "@/modules/containers/components/ContainerGeneralDataForm";
import { ContainerOrderLinksSection } from "@/modules/containers/components/ContainerOrderLinksSection";
import { useContainerGeneralForm } from "@/modules/containers/hooks/useContainerGeneralForm";
import type { ContenedorRow, OrdenDetalle } from "@/modules/containers/types/containerUiTypes";

export type ContainerEditModalProps = {
  contenedorId: string;
  onClose: () => void;
  onSaved: () => void;
  onOrdersChanged?: () => void;
};

export function ContainerEditModal({
  contenedorId,
  onClose,
  onSaved,
  onOrdersChanged,
}: ContainerEditModalProps) {
  const generalForm = useContainerGeneralForm(contenedorId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ordenes, setOrdenes] = useState<OrdenDetalle[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await fetchContainerDetail(contenedorId);
      const contenedor = json.contenedor as ContenedorRow;
      generalForm.applyFromContenedor(contenedor);
      setOrdenes((json.ordenes ?? []) as OrdenDetalle[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error cargando contenedor");
    } finally {
      setLoading(false);
    }
  }, [contenedorId, generalForm.applyFromContenedor]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    const ok = await generalForm.save();
    if (ok) onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="container-edit-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 id="container-edit-title" className="text-sm font-semibold text-slate-800">
            Editar contenedor
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando…
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-500 text-sm py-4">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          ) : (
            <>
              <ContainerGeneralDataForm
                values={generalForm.values}
                onChange={generalForm.patchValues}
              />
              <ContainerOrderLinksSection
                contenedorId={contenedorId}
                linkedOrders={ordenes}
                formValues={generalForm.values}
                onApplyFromOrder={(order, mode) => generalForm.applyFromOrder(order, mode)}
                onLinksChanged={() => {
                  void load();
                  onOrdersChanged?.();
                }}
              />
            </>
          )}

          {generalForm.error ? (
            <p className="text-xs text-red-600">{generalForm.error}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/80">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={loading || generalForm.saving || !generalForm.dirty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {generalForm.saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Guardar datos generales
          </button>
        </div>
      </div>
    </div>
  );
}
