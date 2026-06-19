/**
 * Módulo   : orders
 * Archivo  : modules/orders/components/BaseModal.tsx
 * Qué hace : Modal genérico reutilizable. Gestiona accesibilidad (role=dialog,
 *            aria-modal), cierre por Escape, bloqueo de scroll del body y
 *            variantes de tamaño.
 * Responsabilidad : Solo presentación y control de apertura/cierre.
 *                   No contiene lógica de negocio.
 * No debe          : Importar hooks de datos ni conocer el dominio de pedidos.
 */

"use client";

import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

/** Opciones de ancho máximo del modal. */
const SIZE_CLASSES = {
  sm:  "max-w-md",
  md:  "max-w-lg",
  lg:  "max-w-2xl",
  xl:  "max-w-4xl",
  "2xl": "max-w-6xl",
} as const;

type ModalSize = keyof typeof SIZE_CLASSES;

export interface BaseModalProps {
  /** Controla si el modal está visible. */
  isOpen: boolean;
  /** Callback al cerrar (Escape, botón X o clic en backdrop). */
  onClose: () => void;
  /** Título principal del encabezado. */
  title?: string;
  /** Subtítulo opcional bajo el título. */
  subtitle?: string;
  /** Contenido del modal. */
  children: React.ReactNode;
  /** Ancho máximo del panel. Por defecto "lg". */
  size?: ModalSize;
  /** Cierra al hacer clic fuera del panel. Por defecto true. */
  closeOnBackdropClick?: boolean;
  /** Cierra al pulsar Escape. Por defecto true. */
  closeOnEscape?: boolean;
  /** Muestra el botón X en el encabezado. Por defecto true. */
  showCloseButton?: boolean;
  /** Clases CSS adicionales para el panel. */
  className?: string;
  /** Nodo opcional en la esquina derecha del encabezado (ej. badges de estado). */
  headerActions?: React.ReactNode;
}

/**
 * Panel modal accesible con backdrop semitransparente.
 * Se monta como overlay fijo sobre el viewport.
 */
export default function BaseModal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  size = "lg",
  closeOnBackdropClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  className = "",
  headerActions,
}: BaseModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Cierre por tecla Escape
  useEffect(() => {
    if (!closeOnEscape || !isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeOnEscape, onClose]);

  // Bloqueo de scroll del body mientras el modal está abierto
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "unset";
    return () => { document.body.style.overflow = "unset"; };
  }, [isOpen]);

  // Auto-focus al panel al abrirse para navegación por teclado
  useEffect(() => {
    if (isOpen && modalRef.current) modalRef.current.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (closeOnBackdropClick && e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "base-modal-title" : undefined}
        tabIndex={-1}
        className={`w-full ${SIZE_CLASSES[size]} bg-white rounded-2xl shadow-2xl my-8 focus:outline-none ${className}`}
      >
        {/* Encabezado */}
        {(title || showCloseButton || headerActions) && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div className="flex-1 min-w-0">
              {title && (
                <h2
                  id="base-modal-title"
                  className="text-lg font-bold text-slate-800 truncate"
                >
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
              )}
            </div>

            <div className="flex items-center gap-3 ml-4 shrink-0">
              {headerActions}
              {showCloseButton && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Cerrar"
                  className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Contenido */}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
