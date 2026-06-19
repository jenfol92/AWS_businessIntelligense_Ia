// config/i18n.ts

export const LOCALES = ["es", "en"] as const;

export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "es";

export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && LOCALES.includes(value as AppLocale);
}