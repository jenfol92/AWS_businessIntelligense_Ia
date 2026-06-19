import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

type ResponsiveTableProps = {
  /** Tabla completa visible desde md/lg. */
  desktop: ReactNode;
  /** Cards/listado visible por debajo del breakpoint. */
  mobile: ReactNode;
  /** md = tablet usa cards; lg = solo escritorio ancho usa tabla. */
  breakpoint?: "md" | "lg";
  className?: string;
  desktopClassName?: string;
  mobileClassName?: string;
};

/**
 * Patrón responsive común: tabla en escritorio, cards en móvil.
 * No usar overflow-x-auto como única solución móvil.
 */
export function ResponsiveTable({
  desktop,
  mobile,
  breakpoint = "lg",
  className,
  desktopClassName,
  mobileClassName,
}: ResponsiveTableProps) {
  const bp = breakpoint === "md" ? "md" : "lg";

  return (
    <div className={className}>
      <div className={twMerge(`hidden ${bp}:block`, desktopClassName)}>
        {desktop}
      </div>
      <div className={twMerge(`${bp}:hidden`, mobileClassName)}>{mobile}</div>
    </div>
  );
}
