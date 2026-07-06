import type { SupabaseClient } from "@supabase/supabase-js";

export type PlannerDestinationOption = {
  value: string;
  label: string;
};

export type RegisteredCountry = {
  code: string;
  name: string;
};

const FALLBACK_COUNTRIES: RegisteredCountry[] = [
  { code: "ES", name: "España" },
  { code: "DE", name: "Alemania" },
  { code: "FR", name: "Francia" },
  { code: "IT", name: "Italia" },
  { code: "PT", name: "Portugal" },
  { code: "NL", name: "Países Bajos" },
  { code: "BE", name: "Bélgica" },
  { code: "PL", name: "Polonia" },
  { code: "GB", name: "Reino Unido" },
];

function normalizeCountryRow(row: Record<string, unknown>): RegisteredCountry | null {
  const code = String(row.codigo ?? row.iso ?? row.code ?? row.pais ?? "").trim().toUpperCase();
  const name = String(row.nombre ?? row.name ?? row.label ?? code).trim();
  if (!code) return null;
  return { code, name: name || code };
}

export async function fetchRegisteredCountries(
  supabase: SupabaseClient,
): Promise<RegisteredCountry[]> {
  const { data, error } = await supabase
    .from("paises")
    .select("*")
    .order("code", { ascending: true });

  if (error || !data || data.length === 0) {
    return FALLBACK_COUNTRIES;
  }

  const rows = (data as Record<string, unknown>[])
    .map(normalizeCountryRow)
    .filter((row): row is RegisteredCountry => Boolean(row));

  return rows.length > 0 ? rows : FALLBACK_COUNTRIES;
}

export async function fetchPortCountryMap(
  supabase: SupabaseClient,
): Promise<Map<string, string>> {
  await fetchRegisteredCountries(supabase);
  return new Map<string, string>();
}

export async function buildPlannerDestinationOptions(
  supabase: SupabaseClient,
): Promise<PlannerDestinationOption[]> {
  const countries = await fetchRegisteredCountries(supabase);
  const options: PlannerDestinationOption[] = [
    { value: "ALL", label: "Todos" },
    { value: "FBA", label: "FBA" },
    { value: "ES", label: "ES" },
  ];

  const seen = new Set(["ALL", "FBA", "ES"]);
  for (const country of countries) {
    if (seen.has(country.code)) continue;
    seen.add(country.code);
    options.push({ value: country.code, label: `${country.code} · ${country.name}` });
  }

  return options;
}

export function matchesDestinationFilter(
  filter: string | null | undefined,
  params: {
    destinationBadge: string;
    destinationChannel: string | null;
    destinationCountry: string | null;
  },
): boolean {
  if (!filter || filter === "ALL") return true;

  if (filter === "FBA") {
    return params.destinationBadge === "FBA" || params.destinationChannel === "FBA";
  }

  if (filter === "ES") {
    return params.destinationCountry === "ES" && params.destinationChannel !== "FBA";
  }

  return params.destinationCountry === filter || params.destinationBadge === filter;
}
