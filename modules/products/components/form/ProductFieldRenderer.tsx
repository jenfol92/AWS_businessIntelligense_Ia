"use client";

import { useId, useState, type ReactNode } from "react";
import { HelpCircle, Sparkles } from "lucide-react";
import { twMerge } from "tailwind-merge";
import type {
  ProductFormFieldConfig,
  ProductFormFieldValue,
} from "../../types/product-form.types";
import { pfControl, pfTextarea } from "./productFormUi";

export type ProductFieldRendererProps = {
  field: ProductFormFieldConfig;
  value: ProductFormFieldValue;
  onChange: (value: ProductFormFieldValue) => void;
  onAIHelp?: () => void;
  loading?: boolean;
  inherited?: boolean;
  inheritedValue?: ProductFormFieldValue;
  /** Indica recomendación de categoría sin validación HTML bloqueante. */
  requiredIndicator?: "informative" | "none";
  className?: string;
};

function formatInheritedHint(v: ProductFormFieldValue): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

function asStringArray(v: ProductFormFieldValue): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

function stringValue(v: ProductFormFieldValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function numberValue(v: ProductFormFieldValue): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function boolValue(v: ProductFormFieldValue): boolean {
  return v === true;
}

const inheritedSurface = "bg-sky-50 border-sky-200";

export function ProductFieldRenderer({
  field,
  value,
  onChange,
  onAIHelp,
  loading = false,
  inherited = false,
  inheritedValue,
  requiredIndicator,
  className,
}: ProductFieldRendererProps) {
  const id = useId();
  const fieldId = `${id}-${field.key}`;
  const [helpOpen, setHelpOpen] = useState(false);

  const disabled = Boolean(loading);
  const { validation } = field;
  const showRequiredHint =
    (requiredIndicator ?? (field.required ? "informative" : "none")) ===
    "informative";
  const hasHelpCopy = Boolean(field.helpText?.trim() || field.aiHelp?.trim());
  const multiValue = asStringArray(value);

  const surfaceClass = twMerge(pfControl, inherited && inheritedSurface);

  const labelRow = (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <label
        htmlFor={fieldId}
        className="flex flex-wrap items-center gap-1.5 text-xs font-medium uppercase tracking-[0.06em] text-slate-500"
      >
        <span className="normal-case tracking-normal text-slate-700">
          {field.label}
        </span>
        {showRequiredHint ? (
          <span
            className="text-xs font-normal normal-case tracking-normal text-amber-700"
            title="Recomendado para esta categoría"
          >
            (recomendado)
          </span>
        ) : null}
        {field.unit ? (
          <span className="font-normal text-slate-500">({field.unit})</span>
        ) : null}
        {inherited ? (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
            Heredado
          </span>
        ) : null}
      </label>

      <div className="flex shrink-0 items-center gap-0.5">
        {onAIHelp ? (
          <button
            type="button"
            onClick={onAIHelp}
            disabled={disabled}
            className="rounded-md p-1.5 text-violet-600 transition hover:bg-violet-50 disabled:opacity-50"
            aria-label="Ayuda con IA (próximamente)"
            title="Ayuda con IA (próximamente)"
          >
            <Sparkles className="h-4 w-4" strokeWidth={2} />
          </button>
        ) : null}
        {hasHelpCopy ? (
          <button
            type="button"
            onClick={() => setHelpOpen((o) => !o)}
            className="rounded-md p-1.5 text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
            aria-expanded={helpOpen}
            aria-label="Ayuda contextual"
          >
            <HelpCircle className="h-4 w-4" strokeWidth={2} />
          </button>
        ) : null}
      </div>
    </div>
  );

  const inheritedHint =
    inherited && inheritedValue !== undefined ? (
      <p className="text-xs text-slate-600">
        Valor heredado:{" "}
        <span className="font-medium text-slate-800">
          {formatInheritedHint(inheritedValue)}
        </span>
      </p>
    ) : null;

  const helpPanel =
    helpOpen && hasHelpCopy ? (
      <div
        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
        role="region"
        aria-label={`Ayuda: ${field.label}`}
      >
        {field.helpText?.trim() ? (
          <p className="whitespace-pre-wrap">{field.helpText.trim()}</p>
        ) : null}
        {field.aiHelp?.trim() ? (
          <p
            className={twMerge(
              "whitespace-pre-wrap",
              field.helpText?.trim() ? "mt-2 border-t border-slate-200 pt-2" : "",
            )}
          >
            <span className="font-semibold text-slate-600">IA: </span>
            {field.aiHelp.trim()}
          </p>
        ) : null}
      </div>
    ) : null;

  let control: ReactNode = null;

  switch (field.type) {
    case "text":
      control = (
        <input
          id={fieldId}
          type="text"
          name={field.key}
          value={stringValue(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          maxLength={validation?.maxLength}
          pattern={validation?.pattern}
          disabled={disabled}
          className={surfaceClass}
        />
      );
      break;
    case "number": {
      const n = numberValue(value);
      control = (
        <input
          id={fieldId}
          type="number"
          name={field.key}
          value={n === null ? "" : n}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(null);
              return;
            }
            const parsed = Number(raw);
            onChange(Number.isFinite(parsed) ? parsed : null);
          }}
          placeholder={field.placeholder}
          min={validation?.min}
          max={validation?.max}
          step="any"
          disabled={disabled}
          className={surfaceClass}
        />
      );
      break;
    }
    case "textarea":
      control = (
        <textarea
          id={fieldId}
          name={field.key}
          value={stringValue(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          maxLength={validation?.maxLength}
          rows={4}
          disabled={disabled}
          className={twMerge(pfTextarea, inherited && inheritedSurface)}
        />
      );
      break;
    case "select":
      control = (
        <select
          id={fieldId}
          name={field.key}
          value={stringValue(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={surfaceClass}
        >
          <option value="">{field.placeholder ?? "Seleccionar…"}</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
      break;
    case "multi-select":
      control = (
        <select
          id={fieldId}
          name={field.key}
          multiple
          value={multiValue}
          onChange={(e) => {
            const selected = Array.from(e.target.selectedOptions).map(
              (opt) => opt.value,
            );
            onChange(selected);
          }}
          disabled={disabled}
          className={twMerge(
            pfControl,
            "h-auto min-h-[120px] py-2",
            inherited && inheritedSurface,
          )}
          size={Math.min(8, Math.max(3, (field.options?.length ?? 0) || 3))}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
      break;
    case "boolean":
      control = (
        <div
          className={twMerge(
            "flex items-center gap-3 rounded-lg border px-3 py-2",
            inherited ? inheritedSurface : "border-slate-200 bg-white",
          )}
        >
          <input
            id={fieldId}
            type="checkbox"
            name={field.key}
            checked={boolValue(value)}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60"
          />
          <span className="text-sm text-slate-700">
            {field.placeholder ?? "Activar"}
          </span>
        </div>
      );
      break;
    default: {
      const _unhandled: never = field.type;
      throw new Error(`Tipo de campo no soportado: ${String(_unhandled)}`);
    }
  }

  return (
    <div className={twMerge("space-y-1.5", className)}>
      {labelRow}
      {inheritedHint}
      {helpPanel}
      {control}
    </div>
  );
}
