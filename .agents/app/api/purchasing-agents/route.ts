import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export async function GET() {
  const supabase = createSupabaseRouteClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("agentes_compra")
    .select("id, contacto")
    .order("contacto", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rows: data ?? [] });
}
