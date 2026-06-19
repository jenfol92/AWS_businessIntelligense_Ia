"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { SupplierEnriched } from "../types/supplier.types";

type PortOption = { id: string; name: string };
type AgentOption = { id: string; contacto: string | null };

export type SupplierFormPayload = {
  nombre: string;
  pais: string;
  provincia: string;
  ciudad: string;
  puerto_preferido_id: string;
  latitud: string;
  longitud: string;
  dias_produccion_estandar: string;
  dias_transito_estandar: string;
  deposito_porcentaje: number;
  balance_dias_antes_eta: number;
  balance_condiciones_texto: string;
  agente_id: string;
};

type SupplierFormModalProps = {
  supplier: SupplierEnriched | null;
  ports: PortOption[];
  agents: AgentOption[];
  onClose: () => void;
  onSaved: () => void;
};

const DEFAULT_BALANCE_TEXT =
  "The balance will be paid 10 days before the vessel arrives at the port";

function emptyForm(): SupplierFormPayload {
  return {
    nombre: "",
    pais: "",
    provincia: "",
    ciudad: "",
    puerto_preferido_id: "",
    latitud: "",
    longitud: "",
    dias_produccion_estandar: "",
    dias_transito_estandar: "",
    deposito_porcentaje: 30,
    balance_dias_antes_eta: 10,
    balance_condiciones_texto: DEFAULT_BALANCE_TEXT,
    agente_id: "",
  };
}

function fromSupplier(s: SupplierEnriched): SupplierFormPayload {
  return {
    nombre: s.nombre,
    pais: s.pais ?? "",
    provincia: s.provincia ?? "",
    ciudad: s.ciudad ?? "",
    puerto_preferido_id: s.puerto_preferido_id ?? "",
    latitud: s.latitud != null ? String(s.latitud) : "",
    longitud: s.longitud != null ? String(s.longitud) : "",
    dias_produccion_estandar:
      s.dias_produccion_estandar != null
        ? String(s.dias_produccion_estandar)
        : "",
    dias_transito_estandar:
      s.dias_transito_estandar != null ? String(s.dias_transito_estandar) : "",
    deposito_porcentaje: s.deposito_porcentaje ?? 30,
    balance_dias_antes_eta: s.balance_dias_antes_eta ?? 10,
    balance_condiciones_texto:
      s.balance_condiciones_texto ?? DEFAULT_BALANCE_TEXT,
    agente_id: s.agente_id ?? "",
  };
}

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

export function SupplierFormModal({
  supplier,
  ports,
  agents,
  onClose,
  onSaved,
}: SupplierFormModalProps) {
  const isEdit = supplier != null;
  const [form, setForm] = useState<SupplierFormPayload>(
    supplier ? fromSupplier(supplier) : emptyForm(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(supplier ? fromSupplier(supplier) : emptyForm());
    setError(null);
  }, [supplier]);

  function patch(partial: Partial<SupplierFormPayload>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  async function handleSave() {
    if (!form.nombre.trim()) {
      setError("El nombre del proveedor es obligatorio.");
      return;
    }

    setSaving(true);
    setError(null);

    const selectedPort = ports.find((p) => p.id === form.puerto_preferido_id);

    const body = {
      nombre: form.nombre.trim(),
      pais: form.pais.trim() || null,
      provincia: form.provincia.trim() || null,
      ciudad: form.ciudad.trim() || null,
      puerto_preferido_id: form.puerto_preferido_id || null,
      puerto_preferido: selectedPort?.name ?? null,
      latitud: form.latitud.trim() === "" ? null : Number(form.latitud),
      longitud: form.longitud.trim() === "" ? null : Number(form.longitud),
      dias_produccion_estandar:
        form.dias_produccion_estandar.trim() === ""
          ? null
          : Number(form.dias_produccion_estandar),
      dias_transito_estandar:
        form.dias_transito_estandar.trim() === ""
          ? null
          : Number(form.dias_transito_estandar),
      deposito_porcentaje: form.deposito_porcentaje,
      balance_dias_antes_eta: form.balance_dias_antes_eta,
      balance_condiciones_texto: form.balance_condiciones_texto.trim(),
      agente_id: form.agente_id || null,
    };

    try {
      const url = isEdit
        ? `/api/suppliers/${supplier.id}`
        : "/api/suppliers";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Error guardando proveedor.");
      }

      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-3xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-800">
            {isEdit ? "Editar proveedor" : "Nuevo proveedor"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          <section>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">
              Datos generales
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Nombre *
                </label>
                <input
                  value={form.nombre}
                  onChange={(e) => patch({ nombre: e.target.value })}
                  className={inputClass}
                  placeholder="Factory ABC Co., Ltd"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  País
                </label>
                <input
                  value={form.pais}
                  onChange={(e) => patch({ pais: e.target.value })}
                  className={inputClass}
                  placeholder="China"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Provincia
                </label>
                <input
                  value={form.provincia}
                  onChange={(e) => patch({ provincia: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Ciudad
                </label>
                <input
                  value={form.ciudad}
                  onChange={(e) => patch({ ciudad: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Agente de compra
                </label>
                <select
                  value={form.agente_id}
                  onChange={(e) => patch({ agente_id: e.target.value })}
                  className={`${inputClass} bg-white`}
                >
                  <option value="">— Sin agente —</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.contacto ?? "Sin contacto"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">
              Logística y ubicación
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Puerto preferido (puertos_china)
                </label>
                <select
                  value={form.puerto_preferido_id}
                  onChange={(e) =>
                    patch({ puerto_preferido_id: e.target.value })
                  }
                  className={`${inputClass} bg-white`}
                >
                  <option value="">— Sin puerto —</option>
                  {ports.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Días producción estándar
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={form.dias_produccion_estandar}
                  onChange={(e) =>
                    patch({ dias_produccion_estandar: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Días tránsito estándar
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={form.dias_transito_estandar}
                  onChange={(e) =>
                    patch({ dias_transito_estandar: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Latitud
                </label>
                <input
                  type="number"
                  step="any"
                  value={form.latitud}
                  onChange={(e) => patch({ latitud: e.target.value })}
                  className={inputClass}
                  placeholder="30.2741"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Longitud
                </label>
                <input
                  type="number"
                  step="any"
                  value={form.longitud}
                  onChange={(e) => patch({ longitud: e.target.value })}
                  className={inputClass}
                  placeholder="120.1551"
                />
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">
              Condiciones de pago (por defecto en pedidos)
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Depósito (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.deposito_porcentaje}
                  onChange={(e) =>
                    patch({ deposito_porcentaje: Number(e.target.value) })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Balance (días antes de ETA)
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.balance_dias_antes_eta}
                  onChange={(e) =>
                    patch({ balance_dias_antes_eta: Number(e.target.value) })
                  }
                  className={inputClass}
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Texto condiciones balance
                </label>
                <textarea
                  value={form.balance_condiciones_texto}
                  onChange={(e) =>
                    patch({ balance_condiciones_texto: e.target.value })
                  }
                  rows={2}
                  className={`${inputClass} resize-none`}
                />
              </div>
            </div>
          </section>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear proveedor"}
          </button>
        </div>
      </div>
    </div>
  );
}
