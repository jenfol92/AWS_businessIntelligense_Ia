// modules/products/components/ProductDetailHeader.tsx

"use client";

import { Button, Text, Title } from "@tremor/react";

type ProductDetailHeaderProps = {
  sku: string;
  nombre: string;
  onBack: () => void;
  onEdit: () => void;
  onReload: () => void;
};

// Cabecera superior de la ficha.
// Solo acciones de navegación y contexto.
export function ProductDetailHeader({
  sku,
  nombre,
  onBack,
  onEdit,
  onReload,
}: ProductDetailHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-slate-200/80 pb-6 dark:border-dark-tremor-border md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <button
          type="button"
          onClick={onBack}
          className="mb-2 block text-left text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Volver al catálogo
        </button>
        <Title className="truncate text-slate-900 dark:text-dark-tremor-content-strong">
          {nombre}
        </Title>
        <Text className="mt-1 font-mono text-sm">{sku || "—"}</Text>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        <Button type="button" variant="secondary" size="xs" onClick={onReload}>
          Actualizar
        </Button>
        <Button type="button" variant="primary" size="xs" onClick={onEdit}>
          Editar producto
        </Button>
      </div>
    </header>
  );
}
