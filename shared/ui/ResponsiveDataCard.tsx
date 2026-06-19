import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export type ResponsiveDataCardField = {
  label: string;
  value: ReactNode;
  className?: string;
};

type ResponsiveDataCardProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  fields: ResponsiveDataCardField[];
  actions?: ReactNode;
  footer?: ReactNode;
  onClick?: () => void;
  className?: string;
};

/** Card táctil para filas de listados en móvil. */
export function ResponsiveDataCard({
  title,
  subtitle,
  badges,
  fields,
  actions,
  footer,
  onClick,
  className,
}: ResponsiveDataCardProps) {
  const Wrapper = onClick ? "button" : "article";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={twMerge(
        "w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition",
        onClick && "hover:border-slate-300 hover:bg-slate-50/60 active:bg-slate-50",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          {subtitle ? (
            <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>
          ) : null}
        </div>
        {badges ? <div className="flex shrink-0 flex-wrap justify-end gap-1">{badges}</div> : null}
      </div>

      {fields.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          {fields.map((field) => (
            <div key={field.label} className={field.className}>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {field.label}
              </dt>
              <dd className="mt-0.5 text-sm text-slate-800">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {footer ? <div className="mt-3 text-xs text-slate-600">{footer}</div> : null}

      {actions ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {actions}
        </div>
      ) : null}
    </Wrapper>
  );
}
