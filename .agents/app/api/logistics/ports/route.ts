/**
 * Módulo   : logistics
 * Archivo  : app/api/logistics/ports/route.ts
 * Qué hace : GET — devuelve la lista de puertos de origen (China) y de destino
 *            consultando las tablas reales de Supabase con el cliente admin
 *            para evitar bloqueos de RLS.
 *
 * Esquema real (verificado vía MCP 2026-06-04):
 *
 *   puertos_china:
 *     id uuid PK, nombre text NOT NULL, code text, pais text,
 *     lat numeric, lng numeric, activo boolean, created_at, updated_at
 *
 *   puerto_pais:
 *     puerto text PK (nombre del puerto), pais text NOT NULL
 *     — Sin columna id ni nombre: la PK "puerto" ES el nombre.
 *
 * Decisión de almacenamiento:
 *   contenedores.puerto_salida  y  puerto_llegada son TEXT.
 *   ordenes_compra.fob_puerto es TEXT.
 *   Se guarda siempre el nombre del puerto, nunca el UUID.
 */

import { NextResponse }  from "next/server";
import { supabaseAdmin } from "@/server/supabase/adminClient";

// ─── Tipos de respuesta ────────────────────────────────────────────────────────

/** Puerto de origen (China). El id es el UUID de la tabla puertos_china. */
export interface OriginPort {
  id:    string;
  name:  string;
  code:  string | null;
  pais:  string | null;
}

/**
 * Puerto de destino (país europeo).
 * El id coincide con el nombre (puerto_pais usa "puerto" como PK de texto).
 */
export interface DestinationPort {
  id:      string;   // = nombre del puerto (PK text de puerto_pais)
  name:    string;
  country: string | null;
  code:    null;     // puerto_pais no tiene columna code
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * GET /api/logistics/ports
 *
 * Devuelve todos los puertos sin filtro de activo para garantizar que siempre
 * haya opciones disponibles. Usa supabaseAdmin para evitar bloqueos de RLS.
 *
 * Respuesta con datos:
 * ```json
 * {
 *   "ok": true,
 *   "debug": { "originRawCount": 8, "originFirstKeys": ["id","nombre",...], "originFirstName": "Guangzhou" },
 *   "originPorts":      [{ "id": "uuid", "name": "Ningbo",   "code": "CNNGB",  "pais": "China" }],
 *   "destinationPorts": [{ "id": "Valencia", "name": "Valencia", "country": "ES", "code": null }]
 * }
 * ```
 *
 * Respuesta con error:
 * ```json
 * { "ok": false, "source": "puertos_china", "error": "mensaje" }
 * ```
 */
export async function GET() {

  // ── Puertos de origen: tabla puertos_china ──────────────────────────────────
  // Usamos adminClient para saltar RLS.
  // No filtramos por activo para no quedar con lista vacía si el campo no está relleno.
  const { data: rawOrigen, error: origenError } = await supabaseAdmin
    .from("puertos_china")
    .select("id, nombre, code, pais, activo")
    .order("nombre", { ascending: true });

  if (origenError) {
    console.error("[ports] Error en puertos_china:", origenError.message);
    return NextResponse.json(
      { ok: false, source: "puertos_china", error: origenError.message },
      { status: 500 },
    );
  }

  console.log(
    `[ports] puertos_china raw: ${rawOrigen?.length ?? 0} filas,`,
    `primera fila keys: ${rawOrigen?.[0] ? Object.keys(rawOrigen[0]).join(",") : "—"}`,
    `primer nombre: ${rawOrigen?.[0]?.nombre ?? "—"}`,
  );

  const originPorts: OriginPort[] = (rawOrigen ?? []).map((row) => ({
    id:   String(row.id     ?? ""),
    name: String(row.nombre ?? ""),
    code: row.code ? String(row.code) : null,
    pais: row.pais ? String(row.pais) : null,
  }));

  // ── Puertos de destino: tabla puerto_pais ────────────────────────────────────
  // Esquema: puerto text PK, pais text. Sin id uuid ni columna nombre separada.
  const { data: rawDestino, error: destinoError } = await supabaseAdmin
    .from("puerto_pais")
    .select("puerto, pais")
    .order("puerto", { ascending: true });

  if (destinoError) {
    console.error("[ports] Error en puerto_pais:", destinoError.message);
  }

  const destinationPorts: DestinationPort[] = (rawDestino ?? []).map((row) => ({
    id:      String(row.puerto ?? ""),
    name:    String(row.puerto ?? ""),
    country: row.pais ? String(row.pais) : null,
    code:    null,
  }));

  return NextResponse.json({
    ok: true,
    debug: {
      originRawCount:  rawOrigen?.length ?? 0,
      originFirstKeys: rawOrigen?.[0] ? Object.keys(rawOrigen[0]) : [],
      originFirstName: rawOrigen?.[0]?.nombre ?? null,
    },
    originPorts,
    destinationPorts,
  });
}
