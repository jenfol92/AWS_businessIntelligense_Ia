"use client";

import { Badge, Button, Card } from "@tremor/react";
import type { ProductDetailParent } from "../../types/product-detail.types";
import { CopyableField } from "./CopyableField";
import {
  asRecord,
  imageUrlFromDetalle,
  strField,
} from "./safeDetalle";

export type ProductIdentityPanelProps = {
  producto: unknown;
  detalle: unknown;
  proveedor: unknown;
  parent: ProductDetailParent;
  /** Referencia de contexto (listado en `ProductVariantNavigation`). */
  variantes: unknown;
  /** Referencia de contexto (listado en `ProductVariantNavigation`). */
  siblings: unknown;
  onNavigateToParent: (parentId: string) => void;
  onAddVariant: () => void;
  className?: string;
};

export function ProductIdentityPanel({
  producto,
  detalle,
  proveedor,
  parent,
  variantes,
  siblings,
  onNavigateToParent,
  onAddVariant,
  className = "",
}: ProductIdentityPanelProps) {
  const vCount = Array.isArray(variantes) ? variantes.length : 0;
  const sCount = Array.isArray(siblings) ? siblings.length : 0;
  const p = asRecord(producto);
  const d = asRecord(detalle);
  const prov = asRecord(proveedor);

  const nombre =
    strField(p, "nombre") ?? strField(d, "nombre") ?? "Producto";
  const imagen = imageUrlFromDetalle(detalle);
  const sku = strField(p, "sku");
  const asin = strField(p, "asin");
  const categoriaObj = asRecord(d?.categoria);
const categoria =
  strField(categoriaObj, "nombre") ??
  strField(d, "categoria_nombre") ??
  strField(d, "categoria");
  const estado = strField(p, "estado");
  const proveedorNombre = strField(prov, "nombre");
  const puerto = strField(prov, "puerto_preferido");

  const parentLabel =
    parent &&
    [parent.sku, parent.nombre].filter(Boolean).join(" · ");

  return (
    <Card
      className={`border border-slate-200/80 bg-white shadow-sm ring-1 ring-slate-100/90 dark:border-dark-tremor-border dark:bg-dark-tremor-background-muted dark:ring-dark-tremor-border ${className}`}
    >
      <div className="flex flex-col gap-6 p-4 sm:flex-row sm:items-start sm:gap-8 sm:p-6">
        <div className="mx-auto w-full max-w-[280px] shrink-0 sm:mx-0">
          <div className="aspect-[4/3] w-full overflow-hidden rounded-tremor-default border border-slate-200/80 bg-slate-50 dark:border-dark-tremor-border dark:bg-dark-tremor-background">
            {imagen ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imagen}
                alt={nombre}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400 dark:text-dark-tremor-content-subtle">
                Sin imagen
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-dark-tremor-content-strong sm:text-2xl">
                {nombre}
              </h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {estado && (
                  <Badge color="slate" size="xs">
                    {estado}
                  </Badge>
                )}
                {strField(d, "marca") && (
                  <Badge color="gray" size="xs">
                    {strField(d, "marca")}
                  </Badge>
                )}
                {strField(d, "color") && (
                  <Badge color="gray" size="xs">
                    {strField(d, "color")}
                  </Badge>
                )}
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={onAddVariant}
              className="shrink-0"
            >
              Añadir variante
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <CopyableField label="SKU" value={sku} />
            <CopyableField label="ASIN" value={asin} />
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-dark-tremor-content-subtle">
                Categoría
              </div>
              <div className="mt-1 font-mono text-sm text-slate-800 dark:text-dark-tremor-content-strong">
                {categoria ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-dark-tremor-content-subtle">
                Proveedor
              </div>
              <div className="mt-1 text-sm font-medium text-slate-800 dark:text-dark-tremor-content-strong">
                {proveedorNombre ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-dark-tremor-content-subtle">
                Puerto preferido
              </div>
              <div className="mt-1 font-mono text-sm text-slate-800 dark:text-dark-tremor-content-strong">
                {puerto ?? "—"}
              </div>
            </div>
          </div>

          {parent?.id && (
            <div className="rounded-tremor-default border border-slate-200/80 bg-slate-50/80 p-3 dark:border-dark-tremor-border dark:bg-dark-tremor-background">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-dark-tremor-content-subtle">
                Producto padre
              </div>
              <button
                type="button"
                onClick={() => onNavigateToParent(parent.id)}
                className="mt-1 text-left text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
              >
                {parentLabel || parent.id}
              </button>
            </div>
          )}

          {(vCount > 0 || sCount > 0) && (
            <p className="text-xs text-slate-500 dark:text-dark-tremor-content-subtle">
              {[
                vCount > 0
                  ? `${vCount} variante${vCount === 1 ? "" : "s"}`
                  : null,
                sCount > 0
                  ? `${sCount} hermana${sCount === 1 ? "" : "s"}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              . Abre otra ficha con las tarjetas siguientes.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
