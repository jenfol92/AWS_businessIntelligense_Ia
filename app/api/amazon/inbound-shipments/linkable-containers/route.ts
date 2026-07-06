/**
 * Modulo: Amazon AGL.
 * Responsabilidad: listar contenedores AGL candidatos para vinculacion manual.
 * No debe modificar contenedores, amazon_envios, stock ni estados logisticos.
 */

import { NextResponse } from "next/server";
import { listLinkableAglContainers } from "@/modules/amazon-sp-api/linkInboundShipmentContainerService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const containers = await listLinkableAglContainers();
    return NextResponse.json({ ok: true, containers });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error listando contenedores AGL",
      },
      { status: 400 },
    );
  }
}
