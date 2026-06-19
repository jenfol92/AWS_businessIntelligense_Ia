// i18n.ts

import { getRequestConfig } from "next-intl/server";
import { unstable_noStore } from "next/cache";
import { DEFAULT_LOCALE, isLocale } from "@/config/i18n";

export default getRequestConfig(async ({ locale }) => {
  unstable_noStore();

  const resolvedLocale = isLocale(locale) ? locale : DEFAULT_LOCALE;

  return {
    locale: resolvedLocale,
    messages: (await import(`./messages/${resolvedLocale}.json`)).default,
  };
});