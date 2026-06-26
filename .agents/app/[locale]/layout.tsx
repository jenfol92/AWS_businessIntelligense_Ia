// app/[locale]/layout.tsx

import "../globals.css";
import { NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { isLocale } from "@/config/i18n";
import { Inter } from "next/font/google";

export const dynamic = "force-dynamic";

const inter = Inter({ subsets: ["latin"] });

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  if (!isLocale(params.locale)) notFound();

  const messages = (await import(`@/messages/${params.locale}.json`))
    .default;

  return (
    <NextIntlClientProvider locale={params.locale} messages={messages}>
      <div
        className={`${inter.className} antialiased bg-slate-50 text-slate-900 min-h-screen`}
      >
        {children}
      </div>
    </NextIntlClientProvider>
  );
}