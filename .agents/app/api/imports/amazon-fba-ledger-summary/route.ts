import { NextResponse } from "next/server";
import { importAmazonFbaLedgerSummary } from "@/modules/imports/amazon-fba-ledger-summary/service";
import type { AmazonFbaLedgerImportMode } from "@/modules/imports/amazon-fba-ledger-summary/types";

export const dynamic = "force-dynamic";

function parseMode(value: FormDataEntryValue | null): AmazonFbaLedgerImportMode {
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
        { ok: false, error: "Debes subir un archivo CSV." },
        { status: 400 },
      );
    }

    const mode = parseMode(formData.get("mode"));
    const source =
      String(formData.get("source") ?? "amazon_fba_ledger_summary_manual").trim() ||
      "amazon_fba_ledger_summary_manual";

    const skipUnlinkedProducts = parseSkipUnlinkedProducts(
      formData.get("skipUnlinkedProducts"),
    );

    const result = await importAmazonFbaLedgerSummary({
      file,
      mode,
      source,
      skipUnlinkedProducts,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Error al importar el CSV.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
