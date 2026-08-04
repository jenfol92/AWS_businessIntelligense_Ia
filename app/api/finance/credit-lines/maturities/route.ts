import { NextResponse } from "next/server";
import { buildCreditLineMaturities } from "@/modules/finance/services/buildCreditLineMaturities";
import type {
  CreditLineMaturitiesQuery,
  CreditLineMaturityFilter,
} from "@/modules/finance/types/creditLineMaturities.types";
import {
  assertDateRange,
  isRealIsoDate,
  isUuid,
} from "@/modules/finance/utils/financeInputValidation";
import {
  getFinanceAccessErrorResponse,
  requireTreasuryAccess,
} from "@/server/auth/requireFinanceAccess";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_FILTERS: CreditLineMaturityFilter[] = [
  "all",
  "overdue",
  "next_7",
  "next_15",
  "this_month",
  "partial",
];

export async function GET(req: Request) {
  let access;
  try {
    access = await requireTreasuryAccess();
  } catch (error) {
    const access = getFinanceAccessErrorResponse(error);
    if (access) return NextResponse.json(access.body, { status: access.status });
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "Internal server error" }, { status: 500 });
  }

  const url = new URL(req.url);
  const statusRaw = url.searchParams.get("status")?.trim() ?? "all";
  if (!STATUS_FILTERS.includes(statusRaw as CreditLineMaturityFilter)) {
    return NextResponse.json(
      { ok: false, error: "status invalido", code: "INVALID_STATUS" },
      { status: 422 },
    );
  }

  const from = url.searchParams.get("from")?.trim() ?? null;
  const to = url.searchParams.get("to")?.trim() ?? null;
  const creditLineId = url.searchParams.get("creditLineId")?.trim() ?? null;

  if (from && !isRealIsoDate(from)) {
    return NextResponse.json(
      { ok: false, error: "from no es una fecha valida", code: "INVALID_DATE" },
      { status: 422 },
    );
  }
  if (to && !isRealIsoDate(to)) {
    return NextResponse.json(
      { ok: false, error: "to no es una fecha valida", code: "INVALID_DATE" },
      { status: 422 },
    );
  }
  try {
    assertDateRange(from, to);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rango de fechas invalido";
    return NextResponse.json({ ok: false, error: message, code: "INVALID_DATE_RANGE" }, { status: 422 });
  }
  if (creditLineId && !isUuid(creditLineId)) {
    return NextResponse.json(
      { ok: false, error: "creditLineId debe ser un UUID valido", code: "INVALID_UUID" },
      { status: 422 },
    );
  }

  const query: CreditLineMaturitiesQuery = {
    status: statusRaw as CreditLineMaturityFilter,
  };
  if (from) query.from = from;
  if (to) query.to = to;
  if (creditLineId) query.creditLineId = creditLineId;

  try {
    const canManage = access.role === "admin" || access.role === "accounting";
    const data = await buildCreditLineMaturities(query, canManage, canManage);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { ok: false, code: "INTERNAL_ERROR", error: "Internal server error" },
      { status: 500 },
    );
  }
}
