import { NextResponse } from "next/server";
import { buildCreditLineMaturities } from "@/modules/finance/services/buildCreditLineMaturities";
import type {
  CreditLineMaturitiesQuery,
  CreditLineMaturityFilter,
} from "@/modules/finance/types/creditLineMaturities.types";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

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

function isIsoDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isUuid(value: string | null): value is string {
  return Boolean(
    value
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

export async function GET(req: Request) {
  const supabase = createSupabaseRouteClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(req.url);
  const statusRaw = url.searchParams.get("status")?.trim() ?? "all";
  if (!STATUS_FILTERS.includes(statusRaw as CreditLineMaturityFilter)) {
    return NextResponse.json(
      { ok: false, error: "status invalido" },
      { status: 400 },
    );
  }

  const from = url.searchParams.get("from")?.trim() ?? null;
  const to = url.searchParams.get("to")?.trim() ?? null;
  const creditLineId = url.searchParams.get("creditLineId")?.trim() ?? null;

  if (from && !isIsoDate(from)) {
    return NextResponse.json({ ok: false, error: "from debe ser YYYY-MM-DD" }, { status: 400 });
  }
  if (to && !isIsoDate(to)) {
    return NextResponse.json({ ok: false, error: "to debe ser YYYY-MM-DD" }, { status: 400 });
  }
  if (creditLineId && !isUuid(creditLineId)) {
    return NextResponse.json({ ok: false, error: "creditLineId invalido" }, { status: 400 });
  }

  const query: CreditLineMaturitiesQuery = {
    status: statusRaw as CreditLineMaturityFilter,
  };
  if (from) query.from = from;
  if (to) query.to = to;
  if (creditLineId) query.creditLineId = creditLineId;

  try {
    const data = await buildCreditLineMaturities(query);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error cargando vencimientos";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
