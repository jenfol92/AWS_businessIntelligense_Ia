import type { SupplierInput } from "../types/supplier.types";

export type SupplierValidationResult =
  | { ok: true; data: SupplierInput }
  | { ok: false; error: string };

function parseOptionalNumber(
  value: unknown,
  label: string,
): { value: number | null; error?: string } {
  if (value === null || value === undefined || value === "") {
    return { value: null };
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { value: null, error: `${label} debe ser numérico.` };
  }
  return { value: n };
}

function parseNonNegativeInt(
  value: unknown,
  label: string,
): { value: number | null; error?: string } {
  const parsed = parseOptionalNumber(value, label);
  if (parsed.error) return parsed;
  if (parsed.value == null) return { value: null };
  if (!Number.isInteger(parsed.value) || parsed.value < 0) {
    return { value: null, error: `${label} debe ser un entero >= 0.` };
  }
  return { value: parsed.value };
}

const DEFAULT_BALANCE_TEXT =
  "The balance will be paid 10 days before the vessel arrives at the port";

/**
 * Valida y normaliza el body de POST/PUT de proveedores.
 */
export function validateSupplierInput(body: unknown): SupplierValidationResult {
  if (body === null || typeof body !== "object") {
    return { ok: false, error: "JSON inválido." };
  }

  const raw = body as Record<string, unknown>;
  const nombre = typeof raw.nombre === "string" ? raw.nombre.trim() : "";
  if (!nombre) {
    return { ok: false, error: "El nombre del proveedor es obligatorio." };
  }

  const lat = parseOptionalNumber(raw.latitud, "Latitud");
  if (lat.error) return { ok: false, error: lat.error };
  const lng = parseOptionalNumber(raw.longitud, "Longitud");
  if (lng.error) return { ok: false, error: lng.error };

  const prod = parseNonNegativeInt(
    raw.dias_produccion_estandar,
    "Días producción",
  );
  if (prod.error) return { ok: false, error: prod.error };
  const trans = parseNonNegativeInt(
    raw.dias_transito_estandar,
    "Días tránsito",
  );
  if (trans.error) return { ok: false, error: trans.error };

  let deposito: number | null = null;
  if (
    raw.deposito_porcentaje !== null &&
    raw.deposito_porcentaje !== undefined &&
    raw.deposito_porcentaje !== ""
  ) {
    const d = Number(raw.deposito_porcentaje);
    if (!Number.isFinite(d) || d < 0 || d > 100) {
      return { ok: false, error: "Depósito debe estar entre 0 y 100." };
    }
    deposito = d;
  }

  let balanceDias: number | null = null;
  if (
    raw.balance_dias_antes_eta !== null &&
    raw.balance_dias_antes_eta !== undefined &&
    raw.balance_dias_antes_eta !== ""
  ) {
    const b = Number(raw.balance_dias_antes_eta);
    if (!Number.isInteger(b) || b < 0) {
      return {
        ok: false,
        error: "Días balance antes de ETA debe ser un entero >= 0.",
      };
    }
    balanceDias = b;
  }

  const strOrNull = (v: unknown) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };

  return {
    ok: true,
    data: {
      nombre,
      pais: strOrNull(raw.pais),
      ciudad: strOrNull(raw.ciudad),
      provincia: strOrNull(raw.provincia),
      puerto_preferido_id: strOrNull(raw.puerto_preferido_id),
      puerto_preferido: strOrNull(raw.puerto_preferido),
      latitud: lat.value,
      longitud: lng.value,
      dias_produccion_estandar: prod.value,
      dias_transito_estandar: trans.value,
      deposito_porcentaje: deposito ?? 30,
      balance_dias_antes_eta: balanceDias ?? 10,
      balance_condiciones_texto:
        strOrNull(raw.balance_condiciones_texto) ?? DEFAULT_BALANCE_TEXT,
      agente_id: strOrNull(raw.agente_id),
    },
  };
}
