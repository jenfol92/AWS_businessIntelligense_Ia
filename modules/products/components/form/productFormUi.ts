import { twMerge } from "tailwind-merge";

/** Fondo de página del formulario producto (solo presentación). */
export const pfPageBg = "min-h-screen bg-slate-50";

/** Contenedor centrado ~1200px. */
export const pfShell =
  "mx-auto w-full max-w-[min(100%,72rem)] px-4 py-8 sm:px-6 lg:px-8";

/** Card blanca con borde suave. */
export const pfCard =
  "overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]";

export const pfCardHeader = "border-b border-slate-100 bg-white px-5 py-4 sm:px-6";

export const pfCardTitle = "text-sm font-semibold tracking-tight text-slate-900";

export const pfCardSubtitle =
  "mt-1 text-xs font-normal leading-relaxed text-slate-500";

export const pfCardBody = "px-5 py-5 sm:px-6";

/** Label pequeña encima del campo. */
export const pfLabel =
  "mb-1.5 block text-xs font-medium uppercase tracking-[0.06em] text-slate-500";

/** Input / select altura uniforme. */
export const pfControl =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 disabled:cursor-not-allowed disabled:opacity-60";

export const pfControlInvalid =
  "border-red-300 focus:border-red-500 focus:ring-red-500/20";

export const pfTextarea =
  "min-h-[6.5rem] w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 resize-y disabled:cursor-not-allowed disabled:opacity-60";

export const pfInvalidFeedback = "mt-1 text-xs text-red-600";

export function pfFieldClass(invalid?: boolean): string {
  return twMerge(pfControl, invalid && pfControlInvalid);
}

/** Rejilla 2 columnas desktop, 1 móvil. */
export const pfGrid = "grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2";

export const pfSpan2 = "sm:col-span-2";
