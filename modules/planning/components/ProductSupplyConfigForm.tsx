// modules/planning/components/ProductSupplyConfigForm.tsx
/**
 * Formulario controlado para la configuración logística de un producto.
 *
 * Ciclo de vida:
 * 1. Al montar (o cambiar `productId`), un `useEffect` solicita GET y rellena el estado local.
 * 2. El usuario edita campos editables; proveedor y agente se muestran solo lectura.
 * 3. Al guardar, se envía PUT con el mismo shape que exige la API (números finitos, puertos como string o null).
 *
 * No usa Supabase: toda la persistencia pasa por rutas `/api/planning/products/...`.
 */

"use client";

import type {
  ProductSupplyConfig,
  ProductSupplyConfigUpsertBody,
} from "@/modules/planning/types";
import {
  Button,
  Callout,
  Divider,
  Grid,
  NumberInput,
  Text,
  TextInput,
  Title,
} from "@tremor/react";
import { Package } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

// ─── Tipos auxiliares para validar JSON de la API ────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Convierte la fila de configuración del GET al cuerpo que el PUT acepta.
 * Incluye ids de proveedor/agente aunque no se editen en UI (se reenvían igualmente).
 */
function configToFormBody(config: ProductSupplyConfig): ProductSupplyConfigUpsertBody {
  return {
    leadTimeProduccionDias: config.leadTimeProduccionDias,
    leadTimeTransporteDias: config.leadTimeTransporteDias,
    leadTimeAduanaDias: config.leadTimeAduanaDias,
    stockSeguridadDias: config.stockSeguridadDias,
    frecuenciaReposicionDias: config.frecuenciaReposicionDias,
    moq: config.moq,
    masterCartonQty: config.masterCartonQty,
    puertoOrigen: config.puertoOrigen,
    puertoDestino: config.puertoDestino,
    proveedorId: config.proveedorId,
    agenteId: config.agenteId,
  };
}

/**
 * Normaliza el valor devuelto por Tremor NumberInput (puede ser NaN si el campo queda vacío).
 */
function normalizeStepperInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

export type ProductSupplyConfigFormProps = {
  /** Id del producto; dispara nueva carga al cambiar. */
  productId: string;
  /**
   * Título visible encima del formulario (por defecto copy estándar).
   * Útil si la tarjeta padre no aporta encabezado propio.
   */
  heading?: string;
  /** Clases Tailwind adicionales en el contenedor raíz. */
  className?: string;
};

export function ProductSupplyConfigForm({
  productId,
  heading = "Parámetros de suministro",
  className = "",
}: ProductSupplyConfigFormProps) {
  /** Estado del formulario alineado con el cuerpo del PUT (incluye ids solo lectura). */
  const [form, setForm] = useState<ProductSupplyConfigUpsertBody | null>(null);

  /** Carga inicial de datos (GET). */
  const [loading, setLoading] = useState(true);

  /** Guardado en curso (PUT). */
  const [saving, setSaving] = useState(false);

  /** Error de red o de validación en lectura. */
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Error al persistir (PUT). */
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * Carga la configuración desde el backend.
   * Si no hay fila en BD, la API devuelve defaults; el formulario se rellena igualmente.
   */
  const loadConfig = useCallback(async () => {
    const id = productId.trim();
    if (!id) {
      setLoadError("Falta el identificador del producto.");
      setForm(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const res = await fetch(`/api/planning/products/${encodeURIComponent(id)}/supply-config`, {
        cache: "no-store",
      });

      const payload: unknown = await res.json();

      if (!res.ok) {
        const errMsg = isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : `Error ${res.status} al cargar la configuración.`;
        throw new Error(errMsg);
      }

      if (
        !isRecord(payload) ||
        payload.ok !== true ||
        !isRecord(payload.config)
      ) {
        throw new Error("Respuesta inválida del servidor.");
      }

      const config = payload.config as unknown as ProductSupplyConfig;
      setForm(configToFormBody(config));
    } catch (e) {
      setForm(null);
      setLoadError(
        e instanceof Error
          ? e.message
          : "No se pudo cargar la configuración de suministro."
      );
    } finally {
      setLoading(false);
    }
  }, [productId]);

  /**
   * Efecto principal: cada vez que cambia `productId` se dispará una lectura.
   * Se evita llamar a Supabase desde el cliente: solo fetch a la ruta Next.
   */
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  /**
   * Persiste el formulario vía PUT y actualiza estado local con la respuesta.
   */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || saving) return;

    const id = productId.trim();
    if (!id) return;

    setSaving(true);
    setSaveError(null);

    try {
      const res = await fetch(`/api/planning/products/${encodeURIComponent(id)}/supply-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const payload: unknown = await res.json();

      if (!res.ok) {
        const errMsg = isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : `Error ${res.status} al guardar.`;
        throw new Error(errMsg);
      }

      if (
        !isRecord(payload) ||
        payload.ok !== true ||
        !isRecord(payload.config)
      ) {
        throw new Error("Respuesta inválida tras guardar.");
      }

      const config = payload.config as unknown as ProductSupplyConfig;
      setForm(configToFormBody(config));
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Error desconocido al guardar."
      );
    } finally {
      setSaving(false);
    }
  };

  /* ─── Estados de UI: carga y error inicial ─── */

  if (loading && !form) {
    return (
      <div className={`rounded-xl border border-slate-200/80 bg-white/80 px-6 py-10 text-center ${className}`}>
        <Text className="text-tremor-content">Cargando configuración…</Text>
      </div>
    );
  }

  if (loadError && !form) {
    return (
      <div className={`space-y-4 ${className}`}>
        <Callout title="No se pudo cargar" color="rose">
          {loadError}
        </Callout>
        <Button type="button" variant="secondary" onClick={() => void loadConfig()}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (!form) {
    return null;
  }

  /* ─── Formulario controlado ─── */

  return (
    <form onSubmit={handleSubmit} className={`space-y-6 ${className}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="mt-0.5 rounded-lg bg-slate-100 p-2 dark:bg-dark-tremor-background-subtle">
            <Package className="h-5 w-5 text-slate-600 dark:text-dark-tremor-content" aria-hidden />
          </div>
          <div>
            <Title className="text-lg">{heading}</Title>
            <Text className="mt-0.5">
              Plazos, MOQ, embalaje y puertos. Proveedor y agente vienen del registro y no se editan aquí.
            </Text>
          </div>
        </div>
      </div>

      {saveError ? (
        <Callout title="Error al guardar" color="rose">
          {saveError}
        </Callout>
      ) : null}

      <Divider />

      {/* Plazos (lead times): producción, transporte, aduanas */}
      <div>
        <Text className="mb-3 font-medium text-tremor-content-emphasis">Lead times (días)</Text>
        <Grid numItems={1} numItemsMd={3} className="gap-4">
          <div>
            <Text className="mb-1">Producción</Text>
            <NumberInput
              name="leadTimeProduccionDias"
              min={0}
              step={1}
              value={form.leadTimeProduccionDias}
              onValueChange={(v) =>
                setForm((prev) =>
                  prev
                    ? {
                        ...prev,
                        leadTimeProduccionDias: normalizeStepperInt(v),
                      }
                    : prev
                )
              }
              disabled={loading || saving}
              placeholder="0"
            />
          </div>
          <div>
            <Text className="mb-1">Transporte</Text>
            <NumberInput
              name="leadTimeTransporteDias"
              min={0}
              step={1}
              value={form.leadTimeTransporteDias}
              onValueChange={(v) =>
                setForm((prev) =>
                  prev
                    ? {
                        ...prev,
                        leadTimeTransporteDias: normalizeStepperInt(v),
                      }
                    : prev
                )
              }
              disabled={loading || saving}
              placeholder="0"
            />
          </div>
          <div>
            <Text className="mb-1">Aduanas</Text>
            <NumberInput
              name="leadTimeAduanaDias"
              min={0}
              step={1}
              value={form.leadTimeAduanaDias}
              onValueChange={(v) =>
                setForm((prev) =>
                  prev
                    ? { ...prev, leadTimeAduanaDias: normalizeStepperInt(v) }
                    : prev
                )
              }
              disabled={loading || saving}
              placeholder="0"
            />
          </div>
        </Grid>
      </div>

      {/* Stock, cadencia de pedido, MOQ y unidades por master */}
      <div>
        <Text className="mb-3 font-medium text-tremor-content-emphasis">Inventario y pedidos</Text>
        <Grid numItems={1} numItemsSm={2} numItemsLg={4} className="gap-4">
          <div>
            <Text className="mb-1">Stock seguridad (días)</Text>
            <NumberInput
              name="stockSeguridadDias"
              min={0}
              step={1}
              value={form.stockSeguridadDias}
              onValueChange={(v) =>
                setForm((prev) =>
                  prev
                    ? { ...prev, stockSeguridadDias: normalizeStepperInt(v) }
                    : prev
                )
              }
              disabled={loading || saving}
            />
          </div>
          <div>
            <Text className="mb-1">Frecuencia reposición (días)</Text>
            <NumberInput
              name="frecuenciaReposicionDias"
              min={0}
              step={1}
              value={form.frecuenciaReposicionDias}
              onValueChange={(v) =>
                setForm((prev) =>
                  prev
                    ? {
                        ...prev,
                        frecuenciaReposicionDias: normalizeStepperInt(v),
                      }
                    : prev
                )
              }
              disabled={loading || saving}
            />
          </div>
          <div>
            <Text className="mb-1">MOQ</Text>
            <NumberInput
              name="moq"
              min={0}
              step={1}
              value={form.moq}
              onValueChange={(v) =>
                setForm((prev) =>
                  prev ? { ...prev, moq: normalizeStepperInt(v) } : prev
                )
              }
              disabled={loading || saving}
            />
          </div>
          <div>
            <Text className="mb-1">Master carton (uds.)</Text>
            <NumberInput
              name="masterCartonQty"
              min={0}
              step={1}
              value={form.masterCartonQty}
              onValueChange={(v) =>
                setForm((prev) =>
                  prev
                    ? { ...prev, masterCartonQty: normalizeStepperInt(v) }
                    : prev
                )
              }
              disabled={loading || saving}
            />
          </div>
        </Grid>
      </div>

      {/* Puertos editables */}
      <div>
        <Text className="mb-3 font-medium text-tremor-content-emphasis">Puertos</Text>
        <Grid numItems={1} numItemsMd={2} className="gap-4">
          <div>
            <Text className="mb-1">Puerto origen</Text>
            <TextInput
              name="puertoOrigen"
              value={form.puertoOrigen ?? ""}
              onValueChange={(v) =>
                setForm((prev) =>
                  prev
                    ? {
                        ...prev,
                        puertoOrigen: v.trim() === "" ? null : v.trim(),
                      }
                    : prev
                )
              }
              disabled={loading || saving}
              placeholder="Ej. Shanghai"
            />
          </div>
          <div>
            <Text className="mb-1">Puerto destino</Text>
            <TextInput
              name="puertoDestino"
              value={form.puertoDestino ?? ""}
              onValueChange={(v) =>
                setForm((prev) =>
                  prev
                    ? {
                        ...prev,
                        puertoDestino: v.trim() === "" ? null : v.trim(),
                      }
                    : prev
                )
              }
              disabled={loading || saving}
              placeholder="Ej. Valencia"
            />
          </div>
        </Grid>
      </div>

      <Divider />

      {/* Proveedor y agente: solo lectura. Los valores siguen en `form` para el PUT. */}
      <div>
        <Text className="mb-3 font-medium text-tremor-content-emphasis">
          Relaciones (solo lectura)
        </Text>
        <Grid numItems={1} numItemsMd={2} className="gap-4">
          <div>
            <Text className="mb-1">Proveedor ID</Text>
            <TextInput
              value={form.proveedorId ?? ""}
              disabled
              placeholder="Sin proveedor asignado"
              className="opacity-90"
            />
          </div>
          <div>
            <Text className="mb-1">Agente ID</Text>
            <TextInput
              value={form.agenteId ?? ""}
              disabled
              placeholder="Sin agente asignado"
              className="opacity-90"
            />
          </div>
        </Grid>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4 dark:border-dark-tremor-border">
        <Button
          type="button"
          variant="secondary"
          disabled={saving || loading}
          onClick={() => void loadConfig()}
        >
          Descartar y recargar
        </Button>
        <Button type="submit" loading={saving} disabled={loading}>
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
