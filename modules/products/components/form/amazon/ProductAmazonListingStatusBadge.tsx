"use client";

import type { AmazonListingStatus } from "../../../types/product-amazon.types";

const STATUS_STYLES: Record<
  AmazonListingStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "Borrador",
    className:
      "border-slate-200 bg-slate-100 text-slate-800 ring-slate-500/10",
  },
  ready: {
    label: "Listo para revisión",
    className: "border-blue-200 bg-blue-50 text-blue-900 ring-blue-600/15",
  },
  active: {
    label: "Activo",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-900 ring-emerald-600/15",
  },
  synced: {
    label: "Sincronizado",
    className:
      "border-teal-200 bg-teal-50 text-teal-900 ring-teal-600/15",
  },
  error: {
    label: "Error",
    className: "border-red-200 bg-red-50 text-red-900 ring-red-600/15",
  },
};

type Props = {
  status: AmazonListingStatus;
  className?: string;
};

export function ProductAmazonListingStatusBadge({ status, className = "" }: Props) {
  const cfg = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-tight ring-1 ${cfg.className} ${className}`}
    >
      {cfg.label}
    </span>
  );
}
