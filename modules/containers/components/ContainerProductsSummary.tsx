"use client";

import { useState } from "react";

export type ContainerProductLine = {
  label: string;
  quantity: number | null;
};

export type ContainerProductsSummaryProps = {
  lines: ContainerProductLine[];
  fallbackText?: string;
  previewCount?: number;
  className?: string;
};

export function ContainerProductsSummary({
  lines,
  fallbackText = "Sin productos",
  previewCount = 2,
  className = "",
}: ContainerProductsSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  if (lines.length === 0) {
    return <p className={`text-xs text-slate-500 ${className}`}>{fallbackText}</p>;
  }

  const preview = lines.slice(0, previewCount);
  const hiddenCount = Math.max(lines.length - previewCount, 0);

  function formatLine(line: ContainerProductLine): string {
    const qty = line.quantity ? ` x${line.quantity}` : "";
    return `${line.label}${qty}`;
  }

  return (
    <div className={className}>
      <p className="text-xs leading-snug text-slate-600">
        {preview.map(formatLine).join(", ")}
        {!expanded && hiddenCount > 0 ? (
          <>
            {" "}
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
            >
              +{hiddenCount} más
            </button>
          </>
        ) : null}
      </p>

      {expanded && hiddenCount > 0 ? (
        <div className="mt-1 space-y-0.5">
          {lines.slice(previewCount).map((line, index) => (
            <p key={`${line.label}-${index}`} className="text-xs text-slate-600">
              {formatLine(line)}
            </p>
          ))}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-[11px] font-medium text-slate-500 hover:text-slate-700 hover:underline"
          >
            Ocultar
          </button>
        </div>
      ) : null}
    </div>
  );
}
