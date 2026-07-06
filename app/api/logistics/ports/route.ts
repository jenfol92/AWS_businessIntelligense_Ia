/**
 * Módulo: logística.
 * Responsabilidad: exponer catálogos ligeros para formularios logísticos.
 * Lee puertos físicos de salida desde `puertos_china` y países destino desde `paises`.
 * No debe resolver stock, forecast, marketplaces Amazon ni reglas de importación.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/server/supabase/adminClient";

export interface OriginPort {
  id: string;
  name: string;
  code: string | null;
  pais: string | null;
}

export interface DestinationCountry {
  id: string;
  code: string;
  name: string;
  country?: string;
}

export type DestinationPort = DestinationCountry & {
  country: string;
};

const FALLBACK_DESTINATION_COUNTRIES: DestinationCountry[] = [
  { id: "ES", code: "ES", name: "España" },
  { id: "DE", code: "DE", name: "Alemania" },
  { id: "IT", code: "IT", name: "Italia" },
  { id: "FR", code: "FR", name: "Francia" },
  { id: "GB", code: "GB", name: "Reino Unido" },
  { id: "PL", code: "PL", name: "Polonia" },
  { id: "NL", code: "NL", name: "Países Bajos" },
  { id: "PT", code: "PT", name: "Portugal" },
];

function normalizeCountryRow(row: Record<string, unknown>): DestinationCountry | null {
  const id = String(row.id ?? row.code ?? "").trim();
  const code = String(row.code ?? row.codigo ?? row.iso ?? "").trim().toUpperCase();
  const name = String(row.name ?? row.nombre ?? code).trim();
  if (!id || !code) return null;
  return { id, code, name: name || code };
}

function buildDestinationPorts(countries: DestinationCountry[]): DestinationPort[] {
  return countries.map((country) => ({
    ...country,
    country: country.code,
  }));
}

/**
 * GET /api/logistics/ports
 *
 * Devuelve catálogos para formularios de logística.
 * Si `paises` no está disponible durante build/despliegue, devuelve un fallback
 * mínimo para que la UI no quede bloqueada.
 */
export async function GET() {
  const { data: rawOrigen, error: origenError } = await supabaseAdmin
    .from("puertos_china")
    .select("id, nombre, code, pais, activo")
    .order("nombre", { ascending: true });

  if (origenError) {
    console.error("[ports] Error en puertos_china:", origenError.message);
  }

  const originPorts: OriginPort[] = (rawOrigen ?? []).map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.nombre ?? ""),
    code: row.code ? String(row.code) : null,
    pais: row.pais ? String(row.pais) : null,
  }));

  const { data: rawCountries, error: countriesError } = await supabaseAdmin
    .from("paises")
    .select("*")
    .order("name", { ascending: true });

  if (countriesError) {
    console.error("[ports] Error en paises:", countriesError.message);
    const destinationPorts = buildDestinationPorts(FALLBACK_DESTINATION_COUNTRIES);
    return NextResponse.json({
      ok: true,
      fallback: true,
      source: "fallback",
      error: countriesError.message,
      debug: {
        originRawCount: rawOrigen?.length ?? 0,
        destinationCountryCount: FALLBACK_DESTINATION_COUNTRIES.length,
      },
      originPorts,
      destinationCountries: FALLBACK_DESTINATION_COUNTRIES,
      destinationPorts,
    });
  }

  const destinationCountries = ((rawCountries ?? []) as Record<string, unknown>[])
    .filter((row) => row.activo == null || row.activo === true)
    .map(normalizeCountryRow)
    .filter((country): country is DestinationCountry => Boolean(country));

  const destinationPorts = buildDestinationPorts(destinationCountries);

  return NextResponse.json({
    ok: true,
    debug: {
      originRawCount: rawOrigen?.length ?? 0,
      destinationCountryCount: destinationCountries.length,
    },
    originPorts,
    destinationCountries,
    destinationPorts,
  });
}
