import { NextResponse } from "next/server";
import { buildArrivalsTimeline } from "@/modules/planner/services/buildArrivalsTimeline";

function parseMonths(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 18) return null;
  return n;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const result = await buildArrivalsTimeline({
      fromMonth: url.searchParams.get("fromMonth"),
      months: parseMonths(url.searchParams.get("months")),
      status: url.searchParams.get("status"),
      destination: url.searchParams.get("destination"),
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error interno al construir el cronograma de llegadas.";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
