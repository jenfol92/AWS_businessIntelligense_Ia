import { NextResponse } from "next/server";
import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { checkSpApiHealth } from "@/modules/amazon-sp-api/spApiClient";

export const dynamic = "force-dynamic";

// TODO: proteger endpoint para rol admin antes de producción.

export async function GET() {
  try {
    const missing = getMissingSpApiEnvKeys();
    if (missing.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "missing_env",
          error: `Faltan credenciales SP-API. Revisa .env.local. (${missing.join(", ")})`,
        },
        { status: 400 },
      );
    }

    const { expiresIn } = await checkSpApiHealth();

    return NextResponse.json({
      ok: true,
      message: "SP-API LWA token obtenido correctamente",
      expiresIn,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      {
        ok: false,
        code: mapped.code,
        error: mapped.message,
      },
      { status: mapped.status ?? 400 },
    );
  }
}
