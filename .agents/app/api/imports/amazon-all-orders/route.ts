import { NextResponse } from "next/server";
import { AllOrdersWrongReportTypeError } from "@/modules/imports/amazon-all-orders/detectReportType";
import { importAmazonAllOrders } from "@/modules/imports/amazon-all-orders/service";
import type { AmazonAllOrdersImportMode } from "@/modules/imports/amazon-all-orders/types";

export const dynamic = "force-dynamic";

function parseMode(value: FormDataEntryValue | null): AmazonAllOrdersImportMode {
  const raw = String(value ?? "preview").trim().toLowerCase();
  return raw === "commit" ? "commit" : "preview";
}

function parseSkipUnlinkedProducts(value: FormDataEntryValue | null): boolean {
  if (value == null) return true;
  const raw = String(value).trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { ok: false, error: "Debes subir un archivo." },
        { status: 400 },
      );
    }

    const mode = parseMode(formData.get("mode"));
    const skipUnlinkedProducts = parseSkipUnlinkedProducts(
      formData.get("skipUnlinkedProducts"),
    );
    const source =
      String(formData.get("source") ?? "amazon_all_orders_manual").trim() ||
      "amazon_all_orders_manual";

    const result = await importAmazonAllOrders({
      file,
      mode,
      source,
      skipUnlinkedProducts,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof AllOrdersWrongReportTypeError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          code: error.code,
          detectedType: error.detectedType,
        },
        { status: 400 },
      );
    }

    const message =
      error instanceof Error ? error.message : "Error al importar el archivo.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
