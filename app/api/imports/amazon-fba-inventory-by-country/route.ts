import { NextResponse } from "next/server";
import { FbaCountryWrongReportTypeError } from "@/modules/imports/amazon-fba-inventory-by-country/detectReportType";
import { importAmazonFbaInventoryByCountry } from "@/modules/imports/amazon-fba-inventory-by-country/service";
import type { AmazonFbaCountryImportMode } from "@/modules/imports/amazon-fba-inventory-by-country/types";

export const dynamic = "force-dynamic";

function parseMode(value: FormDataEntryValue | null): AmazonFbaCountryImportMode {
  const raw = String(value ?? "preview").trim().toLowerCase();
  return raw === "commit" ? "commit" : "preview";
}

function parseSkipUnlinkedProducts(value: FormDataEntryValue | null): boolean {
  if (value == null) return true;
  const raw = String(value).trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

function parseDefaultPais(
  urlPais: string | null,
  formPais: FormDataEntryValue | null,
): string | null {
  const raw =
    String(formPais ?? urlPais ?? "")
      .trim()
      .toUpperCase() || "";
  if (!raw) return null;
  return raw === "UK" ? "GB" : raw;
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { ok: false, error: "Debes subir un archivo CSV o TXT." },
        { status: 400 },
      );
    }

    const mode = parseMode(formData.get("mode"));
    const skipUnlinkedProducts = parseSkipUnlinkedProducts(
      formData.get("skipUnlinkedProducts"),
    );
    const defaultPais = parseDefaultPais(
      url.searchParams.get("pais"),
      formData.get("pais"),
    );
    const source =
      String(formData.get("source") ?? "amazon_fba_country_report").trim() ||
      "amazon_fba_country_report";

    const result = await importAmazonFbaInventoryByCountry({
      file,
      mode,
      source,
      skipUnlinkedProducts,
      defaultPais,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof FbaCountryWrongReportTypeError) {
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
