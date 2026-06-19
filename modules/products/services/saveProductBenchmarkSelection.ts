// modules/products/services/saveProductBenchmarkSelection.ts

import { upsertProductCompetitorSelectionsBatch } from "../repositories/productCompetitorBenchmarkSelectionRepository";
import type { PutProductBenchmarkSelectionBody } from "../types/competitor-benchmark-selection.types";

function assertWeight(value: number | null | undefined, label: string): void {
  if (value == null) return;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} debe estar entre 0 y 1.`);
  }
}

export function validatePutProductBenchmarkSelectionBody(
  body: unknown,
): PutProductBenchmarkSelectionBody {
  if (body == null || typeof body !== "object") {
    throw new Error("Payload inválido.");
  }

  const raw = body as Record<string, unknown>;
  const marketplaceCountry = String(raw.marketplaceCountry ?? "").trim();
  if (!marketplaceCountry) {
    throw new Error("marketplaceCountry es obligatorio.");
  }

  if (!Array.isArray(raw.competitors)) {
    throw new Error("competitors debe ser un array.");
  }

  const competitors = raw.competitors.map((item, index) => {
    if (item == null || typeof item !== "object") {
      throw new Error(`competitors[${index}] inválido.`);
    }
    const c = item as Record<string, unknown>;
    const competitorAsin = String(c.competitorAsin ?? "").trim();
    if (!competitorAsin) {
      throw new Error(`competitors[${index}].competitorAsin es obligatorio.`);
    }

    assertWeight(
      c.weight != null ? Number(c.weight) : null,
      `competitors[${index}].weight`,
    );
    assertWeight(
      c.capturePct != null ? Number(c.capturePct) : null,
      `competitors[${index}].capturePct`,
    );

    return {
      competitorAsin,
      competitorTitle:
        c.competitorTitle != null ? String(c.competitorTitle) : null,
      snapshotId: c.snapshotId != null ? String(c.snapshotId) : null,
      isSelected: c.isSelected !== false,
      useForForecast: c.useForForecast === true,
      weight: c.weight != null ? Number(c.weight) : null,
      capturePct: c.capturePct != null ? Number(c.capturePct) : null,
      notes: c.notes != null ? String(c.notes) : null,
    };
  });

  return { marketplaceCountry, competitors };
}

export async function saveProductBenchmarkSelection(
  productoId: string,
  body: PutProductBenchmarkSelectionBody,
): Promise<{ saved: number }> {
  const saved = await upsertProductCompetitorSelectionsBatch(
    productoId,
    body.marketplaceCountry,
    body.competitors,
  );
  return { saved };
}
