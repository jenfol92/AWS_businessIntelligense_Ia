// middleware.ts

import createIntlMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE_NAME,
  LOCALES,
} from "@/config/i18n";

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const hasLocalePrefix = LOCALES.some(
    (locale) =>
      pathname === `/${locale}` ||
      pathname.startsWith(`/${locale}/`)
  );

  // Redirect automático si no hay locale
  if (!hasLocalePrefix) {
    const cookieLocale = req.cookies.get(LOCALE_COOKIE_NAME)?.value;

    const locale = isLocale(cookieLocale)
      ? cookieLocale
      : DEFAULT_LOCALE;

    return NextResponse.redirect(
      new URL(`/${locale}${pathname}${search}`, req.url)
    );
  }

  const intlMiddleware = createIntlMiddleware({
    locales: [...LOCALES],
    defaultLocale: DEFAULT_LOCALE,
    localePrefix: "always",
    localeDetection: false,
  });

  const res = intlMiddleware(req);

  // Supabase SSR
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },

        set(name: string, value: string, options: any) {
          res.cookies.set({
            name,
            value,
            ...options,
          });
        },

        remove(name: string, options: any) {
          res.cookies.set({
            name,
            value: "",
            ...options,
          });
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const path = pathname.replace(/^\/(es|en)(\/|$)/, "/");

  const isProtectedRoute =
    path === "/" ||
    path.startsWith("/logistica") ||
    path.startsWith("/finanzas") ||
    path.startsWith("/inventario") ||
    path.startsWith("/productos") ||
    path.startsWith("/pedidos") ||
    path.startsWith("/proveedores") ||
    path.startsWith("/planificador") ||
    path.startsWith("/coo");

  const currentLocale = pathname.split("/")[1] || DEFAULT_LOCALE;

  // No autenticado → login
  if (!session && isProtectedRoute) {
    return NextResponse.redirect(
      new URL(`/${currentLocale}/login`, req.url)
    );
  }

  // Ya autenticado → fuera del login
  if (session && path === "/login") {
    return NextResponse.redirect(
      new URL(`/${currentLocale}`, req.url)
    );
  }

  return res;
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
