import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE_NAME } from "@/config/i18n";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const locale = body?.locale;

  if (!isLocale(locale)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  cookies().set(LOCALE_COOKIE_NAME, locale, {
    path: "/",
    sameSite: "lax",
  });

  return NextResponse.json({ ok: true });
}