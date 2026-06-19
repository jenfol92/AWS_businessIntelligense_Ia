"use client";

import { CheckCircle2 } from "lucide-react";
import type { AmazonContentValidationWarning } from "../../../validators/amazonContentValidator";
import { groupAmazonWarnings } from "./productAmazonHelpers";

type Props = {
  warnings: AmazonContentValidationWarning[];
};

export function ProductAmazonWarningsPanel({ warnings }: Props) {
  if (warnings.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200/80 bg-emerald-50/60 px-4 py-3">
        <CheckCircle2
          className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
          strokeWidth={2}
          aria-hidden
        />
        <div>
          <p className="text-sm font-semibold text-emerald-900">
            Sin avisos de calidad
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-emerald-800/90">
            No se detectan problemas habituales en título, descripción, bullets
            ni términos de búsqueda. Sigue revisando antes de publicar.
          </p>
        </div>
      </div>
    );
  }

  const groups = groupAmazonWarnings(warnings);

  return (
    <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-amber-900/80">
        Avisos ({warnings.length})
      </p>
      <p className="mt-1 text-xs text-amber-900/75">
        Sugerencias de cumplimiento; no bloquean el guardado.
      </p>
      <div className="mt-3 space-y-3">
        {groups.map((g) => (
          <div key={g.id}>
            <p className="text-xs font-medium text-amber-950">{g.label}</p>
            <ul className="mt-1 space-y-1.5 pl-3 text-sm leading-snug text-amber-950/90">
              {g.items.map((w) => (
                <li key={w.code} className="border-l-2 border-amber-300/80 pl-2">
                  {w.message}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
