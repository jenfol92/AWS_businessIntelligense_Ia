"use client";

import { useCallback, useState } from "react";
import type { ContenedorRow } from "@/modules/containers/types/containerUiTypes";
import { updateContainer } from "@/modules/containers/api/containerClient";
import {
  mergeOrderFieldsIntoValues,
  mergeOrdersToContainerFields,
  type OrderContainerSource,
} from "@/modules/containers/utils/mapOrderToContainerFields";

export type ContainerGeneralFormValues = {
  identificador_embarque: string;
  tipo_contenedor: "propio" | "amazon_agl";
  destino_pais_id: string;
  transitario: string;
  puerto_salida: string;
  puerto_llegada: string;
  fecha_salida: string;
  fecha_eta_estimada: string;
  notas: string;
};

const EMPTY_VALUES: ContainerGeneralFormValues = {
  identificador_embarque: "",
  tipo_contenedor:       "propio",
  destino_pais_id:       "",
  transitario:           "",
  puerto_salida:         "",
  puerto_llegada:        "",
  fecha_salida:          "",
  fecha_eta_estimada:    "",
  notas:                 "",
};

function valuesFromContenedor(c: ContenedorRow): ContainerGeneralFormValues {
  return {
    identificador_embarque: c.identificador_embarque ?? "",
    tipo_contenedor:
      c.tipo_contenedor?.toLowerCase() === "amazon_agl" ? "amazon_agl" : "propio",
    destino_pais_id:    c.destino_pais_id ?? "",
    transitario:        c.transitario ?? "",
    puerto_salida:      c.puerto_salida ?? "",
    puerto_llegada:     c.puerto_llegada ?? "",
    fecha_salida:       c.fecha_salida?.slice(0, 10) ?? "",
    fecha_eta_estimada: c.fecha_eta_estimada?.slice(0, 10) ?? "",
    notas:              c.notas ?? "",
  };
}

export function useContainerGeneralForm(contenedorId: string) {
  const [values, setValues] = useState<ContainerGeneralFormValues>(EMPTY_VALUES);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyFromContenedor = useCallback((c: ContenedorRow) => {
    setValues(valuesFromContenedor(c));
    setDirty(false);
    setError(null);
  }, []);

  const patchValues = useCallback((patch: Partial<ContainerGeneralFormValues>) => {
    setValues((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }, []);

  const applyFromOrder = useCallback((
    orders: OrderContainerSource | OrderContainerSource[],
    mode: "empty_only" | "force" = "empty_only",
  ) => {
    const sources = Array.isArray(orders) ? orders : [orders];
    const fromOrder = mergeOrdersToContainerFields(sources);
    setValues((prev) => mergeOrderFieldsIntoValues(prev, fromOrder, mode));
    setDirty(true);
    setError(null);
  }, []);

  const buildUpdatePayload = useCallback(() => ({
    identificador_embarque: values.identificador_embarque.trim() || undefined,
    tipo_contenedor:        values.tipo_contenedor,
    destino_pais_id:        values.destino_pais_id || null,
    transitario:            values.transitario || null,
    puerto_salida:          values.puerto_salida || null,
    puerto_llegada:         values.puerto_llegada || null,
    fecha_salida:           values.fecha_salida || null,
    fecha_eta_estimada:     values.fecha_eta_estimada || null,
    notas:                  values.notas || null,
  }), [values]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await updateContainer(contenedorId, buildUpdatePayload());
      setDirty(false);
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar datos generales");
      return false;
    } finally {
      setSaving(false);
    }
  }, [buildUpdatePayload, contenedorId]);

  return {
    values,
    dirty,
    saving,
    error,
    patchValues,
    applyFromContenedor,
    applyFromOrder,
    buildUpdatePayload,
    save,
    setError,
  };
}
