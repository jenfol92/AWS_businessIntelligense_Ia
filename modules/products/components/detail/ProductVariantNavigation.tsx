"use client";

import { Card } from "@tremor/react";
import type {
  ProductDetailSibling,
  ProductDetailVariante,
} from "../../types/product-detail.types";

export type ProductVariantNavigationProps = {
  currentProductId: string;
  variantes: ProductDetailVariante[];
  siblings: ProductDetailSibling[];
  onSelectProduct: (id: string) => void;
  className?: string;
};

function mergeItems(
  currentProductId: string,
  variantes: ProductDetailVariante[],
  siblings: ProductDetailSibling[],
): Array<{
  id: string;
  sku: string;
  nombre: string;
  imagenUrl: string | null;
  color: string | null;
}> {
  const map = new Map<
    string,
    {
      id: string;
      sku: string;
      nombre: string;
      imagenUrl: string | null;
      color: string | null;
    }
  >();

  for (const v of variantes) {
    if (v.id === currentProductId) continue;
    map.set(v.id, {
      id: v.id,
      sku: v.sku,
      nombre: v.nombre,
      imagenUrl: v.imagenUrl,
      color: v.color,
    });
  }
  for (const s of siblings) {
    if (s.id === currentProductId) continue;
    if (!map.has(s.id)) {
      map.set(s.id, {
        id: s.id,
        sku: s.sku,
        nombre: s.nombre,
        imagenUrl: s.imagenUrl,
        color: s.color,
      });
    }
  }

  return Array.from(map.values());
}

export function ProductVariantNavigation({
  currentProductId,
  variantes,
  siblings,
  onSelectProduct,
  className = "",
}: ProductVariantNavigationProps) {
  const items = mergeItems(currentProductId, variantes, siblings);

  if (items.length === 0) return null;

  return (
    <div className={className}>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-dark-tremor-content-subtle">
        Variantes y hermanas
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectProduct(item.id)}
            className="text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 rounded-tremor-default"
          >
            <Card className="h-full w-36 border border-slate-200/80 p-2 shadow-sm ring-1 ring-slate-100/90 transition hover:border-slate-300 dark:border-dark-tremor-border dark:ring-dark-tremor-border">
              <div className="mb-2 flex h-14 w-full items-center justify-center overflow-hidden rounded bg-slate-100 dark:bg-dark-tremor-background">
                {item.imagenUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imagenUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : item.color ? (
                  <span
                    className="block h-10 w-10 rounded-full border border-slate-200 shadow-inner dark:border-dark-tremor-border"
                    style={{ backgroundColor: item.color }}
                    title={item.color}
                  />
                ) : (
                  <span className="text-[10px] text-slate-400">Sin vista</span>
                )}
              </div>
              <div className="line-clamp-2 text-xs font-medium leading-snug text-slate-900 dark:text-dark-tremor-content-strong">
                {item.nombre}
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500 dark:text-dark-tremor-content">
                {item.sku}
              </div>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}
