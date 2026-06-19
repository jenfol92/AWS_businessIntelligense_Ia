"use client";

import type { AmazonContentQualityScore } from "../../../types/product-amazon.types";
import type { AmazonContentValidationWarning } from "../../../validators/amazonContentValidator";
import {
  getAmazonContentReadiness,
  type AmazonReadinessLevel,
} from "./productAmazonHelpers";

const READINESS_COPY: Record<
  AmazonReadinessLevel,
  { label: string; sub: string; barClass: string }
> = {
  incomplete: {
    label: "Incompleto",
    sub: "Faltan campos clave o la puntuación es muy baja.",
    barClass: "from-rose-400 to-amber-300",
  },
  acceptable: {
    label: "Aceptable",
    sub: "Contenido utilizable; revisa los avisos antes de publicar.",
    barClass: "from-amber-400 to-lime-400",
  },
  ready: {
    label: "Listo para revisión",
    sub: "Buen equilibrio de calidad; última revisión humana recomendada.",
    barClass: "from-emerald-400 to-teal-400",
  },
};

type Props = {
  quality: AmazonContentQualityScore;
  warnings: AmazonContentValidationWarning[];
};

export function ProductAmazonScoreBlock({ quality, warnings }: Props) {
  const readiness = getAmazonContentReadiness(warnings, quality.overall);
  const cfg = READINESS_COPY[readiness];
  const pct = Math.min(100, Math.max(0, quality.overall));

  return (
    <div className="rounded-xl border border-slate-200/90 bg-gradient-to-br from-white to-slate-50/90 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.06em] text-slate-500">
            Calidad del contenido
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-lg font-semibold tabular-nums text-slate-900 shadow-sm">
              {quality.overall}
              <span className="ml-0.5 text-sm font-normal text-slate-500">
                /100
              </span>
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                readiness === "ready"
                  ? "bg-emerald-100 text-emerald-900"
                  : readiness === "acceptable"
                    ? "bg-amber-100 text-amber-950"
                    : "bg-rose-100 text-rose-900"
              }`}
            >
              {cfg.label}
            </span>
          </div>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-600">
            {cfg.sub}
          </p>
        </div>
        <div className="w-full shrink-0 sm:w-40">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200/80">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${cfg.barClass}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            Puntuación estimada
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5">
        {(
          [
            ["Título", quality.breakdown.title],
            ["Desc.", quality.breakdown.description],
            ["Bullets", quality.breakdown.bullets],
            ["Search", quality.breakdown.searchTerms],
            ["KW", quality.breakdown.keywords],
          ] as const
        ).map(([k, v]) => (
          <div
            key={k}
            className="flex items-center justify-between gap-2 rounded-md bg-white/80 px-2 py-1.5 ring-1 ring-slate-100"
          >
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-semibold tabular-nums text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
