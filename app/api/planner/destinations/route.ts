import { NextResponse } from "next/server";
import { buildPlannerDestinationOptions } from "@/modules/planner/repositories/plannerDestinationsRepository";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export async function GET() {
  try {
    const supabase = createSupabaseRouteClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const options = await buildPlannerDestinationOptions(supabase);
    return NextResponse.json({ ok: true, options });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al cargar destinos del planificador.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
