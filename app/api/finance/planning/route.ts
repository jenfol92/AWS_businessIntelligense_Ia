import { NextResponse } from "next/server";
import { buildFinancialPlanning } from "@/modules/finance/services/buildFinancialPlanning";
import type { FinancePlanningQuery } from "@/modules/finance/types/planning.types";
import {
  getFinanceAccessErrorResponse,
  requireTreasuryAccess,
} from "@/server/auth/requireFinanceAccess";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ParseResult =
  | { ok: true; query: FinancePlanningQuery }
  | { ok: false; error: string };

function parseQuery(req: Request): ParseResult {
  const url = new URL(req.url);
  const query: FinancePlanningQuery = {};
  const fromMonth = url.searchParams.get("fromMonth")?.trim();
  const monthsRaw = url.searchParams.get("months")?.trim();

  if (fromMonth) {
    if (!/^\d{4}-\d{2}$/.test(fromMonth)) {
      return { ok: false, error: "fromMonth debe tener formato YYYY-MM." };
    }
    query.fromMonth = fromMonth;
  }

  if (monthsRaw) {
    const months = Number(monthsRaw);
    if (!Number.isInteger(months) || months < 1 || months > 18) {
      return { ok: false, error: "months debe ser un entero entre 1 y 18." };
    }
    query.months = months;
  }

  return { ok: true, query };
}

export async function GET(req: Request) {
  try {
    await requireTreasuryAccess();
    const supabaseHost = (() => {
      try {
        return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
      } catch {
        return "invalid_supabase_url";
      }
    })();
    console.log("[finance/planning] route hit", { supabaseHost });
    const parsed = parseQuery(req);
    if (parsed.ok === false) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }

    console.log("[finance/planning] buildFinancialPlanning start", parsed.query);
    const data = await buildFinancialPlanning(parsed.query);
    console.log("[finance/planning] buildFinancialPlanning done");
    return NextResponse.json(data);
  } catch (error) {
    const access = getFinanceAccessErrorResponse(error);
    if (access) return NextResponse.json(access.body, { status: access.status });
    return NextResponse.json(
      { ok: false, code: "INTERNAL_ERROR", error: "Internal server error" },
      { status: 500 },
    );
  }
}
