"use client";

import { useCallback, useState } from "react";
import { Badge } from "@tremor/react";

type CopyableFieldProps = {
  label: string;
  value: string | null | undefined;
  className?: string;
};

export function CopyableField({
  label,
  value,
  className = "",
}: CopyableFieldProps) {
  const [copied, setCopied] = useState(false);

  const display =
    value != null && String(value).trim() !== "" ? String(value) : null;
  const showEmpty = display === null;

  const copy = useCallback(async () => {
    if (showEmpty) return;
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [display, showEmpty]);

  return (
    <div className={className}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-dark-tremor-content-subtle">
        {label}
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        disabled={showEmpty}
        className="mt-1 flex w-full flex-wrap items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
        title={showEmpty ? undefined : "Copiar al portapapeles"}
      >
        {showEmpty ? (
          <span className="font-mono text-sm text-slate-400 dark:text-dark-tremor-content-subtle">
            —
          </span>
        ) : (
          <Badge
            color="slate"
            className="cursor-pointer font-mono text-xs font-normal"
          >
            {display}
          </Badge>
        )}
        {copied && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            Copiado
          </span>
        )}
      </button>
    </div>
  );
}
