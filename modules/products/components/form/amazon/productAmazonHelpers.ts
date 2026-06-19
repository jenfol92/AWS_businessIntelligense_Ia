import { AMAZON_LANGUAGES } from "../../../constants";
import type {
  AmazonMarketplaceCatalog,
  AmazonMarketplaceContentDraft,
} from "../../../types/product-amazon.types";
import type { AmazonContentValidationWarning } from "../../../validators/amazonContentValidator";

/** Etiqueta UI: nombre del marketplace + código entre paréntesis. */
export function formatMarketplaceDisplayName(
  row: AmazonMarketplaceCatalog | undefined,
  fallbackId: string,
): string {
  if (!row) return fallbackId;
  const code = row.code?.trim();
  if (code) return `${row.name} (${code})`;
  return row.name;
}

/** Idiomas únicos del catálogo; si no hay, lista de respaldo. */
export function languageOptionsFromCatalog(
  catalog: AmazonMarketplaceCatalog[],
  currentDraftLanguage: string,
): string[] {
  const fromDb = new Set<string>();
  for (const c of catalog) {
    const lang = c.languageCode?.trim();
    if (lang) fromDb.add(lang);
  }
  const sorted = Array.from(fromDb).sort((a, b) => a.localeCompare(b));
  const base = sorted.length > 0 ? sorted : [...AMAZON_LANGUAGES];
  if (currentDraftLanguage.trim() && !base.includes(currentDraftLanguage)) {
    return [currentDraftLanguage.trim(), ...base];
  }
  return base;
}

export type AmazonReadinessLevel = "incomplete" | "acceptable" | "ready";

export function getAmazonContentReadiness(
  warnings: AmazonContentValidationWarning[],
  overallScore: number,
): AmazonReadinessLevel {
  const codes = new Set(warnings.map((w) => w.code));
  const coreMissing =
    codes.has("title_empty") ||
    codes.has("desc_empty") ||
    overallScore < 40;
  if (coreMissing) return "incomplete";

  const noWarnings = warnings.length === 0;
  if (noWarnings && overallScore >= 76) return "ready";
  if (noWarnings && overallScore >= 60) return "acceptable";
  return "acceptable";
}

export type WarningGroup = { id: string; label: string; items: AmazonContentValidationWarning[] };

/** Agrupa avisos por área (título, descripción, bullets, search, keywords, otros). */
export function groupAmazonWarnings(
  warnings: AmazonContentValidationWarning[],
): WarningGroup[] {
  const buckets: Record<string, AmazonContentValidationWarning[]> = {
    title: [],
    description: [],
    bullets: [],
    search: [],
    keywords: [],
    other: [],
  };

  for (const w of warnings) {
    const c = w.code;
    if (c.startsWith("title_")) buckets.title.push(w);
    else if (c.startsWith("desc_")) buckets.description.push(w);
    else if (c.startsWith("bullet_") || c === "bullets_count")
      buckets.bullets.push(w);
    else if (c.startsWith("search_terms_")) buckets.search.push(w);
    else if (c.startsWith("keywords_")) buckets.keywords.push(w);
    else buckets.other.push(w);
  }

  const order: { id: keyof typeof buckets; label: string }[] = [
    { id: "title", label: "Título" },
    { id: "description", label: "Descripción" },
    { id: "bullets", label: "Bullets" },
    { id: "search", label: "Search terms" },
    { id: "keywords", label: "Keywords" },
    { id: "other", label: "Otros" },
  ];

  return order
    .map(({ id, label }) => ({
      id,
      label,
      items: buckets[id],
    }))
    .filter((g) => g.items.length > 0);
}

/** ¿Hay texto u otro contenido que justifique confirmar al desasignar? */
export function amazonDraftHasMeaningfulContent(
  draft: AmazonMarketplaceContentDraft,
): boolean {
  const parts: string[] = [
    draft.title,
    draft.description,
    draft.bullet1,
    draft.bullet2,
    draft.bullet3,
    draft.bullet4,
    draft.bullet5,
    draft.keywords,
    draft.searchTerms,
    draft.brand,
    draft.productType,
    draft.browseNodeId,
    draft.targetAudience,
    draft.listingAsin,
    draft.listingSku,
  ];
  if (parts.some((p) => p.trim().length > 0)) return true;
  if (draft.listingStatus !== "draft") return true;
  if (draft.syncEnabled) return true;
  return false;
}
