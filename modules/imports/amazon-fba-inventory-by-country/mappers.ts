const MARKETPLACE_NAME_TO_COUNTRY: Record<string, string> = {
  "amazon.de": "DE",
  "amazon.es": "ES",
  "amazon.fr": "FR",
  "amazon.it": "IT",
  "amazon.co.uk": "GB",
  "amazon.nl": "NL",
  "amazon.pl": "PL",
  "amazon.se": "SE",
  "amazon.com.be": "BE",
  germany: "DE",
  spain: "ES",
  france: "FR",
  italy: "IT",
  "united kingdom": "GB",
  uk: "GB",
  poland: "PL",
  sweden: "SE",
};

export function normalizeCountryCode(raw: string): string {
  const v = raw.trim().toUpperCase();
  if (v === "UK") return "GB";
  if (/^[A-Z]{2}$/.test(v)) return v;
  return v;
}

export function resolveCountryFromValue(
  raw: string,
  defaultPais?: string | null,
): string | null {
  const trimmed = raw.trim();
  if (trimmed) {
    const lower = trimmed.toLowerCase();
    const mapped = MARKETPLACE_NAME_TO_COUNTRY[lower];
    if (mapped) return mapped;

    const upper = normalizeCountryCode(trimmed);
    if (/^[A-Z]{2}$/.test(upper)) return upper;
  }

  if (defaultPais) {
    const d = normalizeCountryCode(defaultPais);
    if (/^[A-Z]{2}$/.test(d)) return d;
  }

  return null;
}
