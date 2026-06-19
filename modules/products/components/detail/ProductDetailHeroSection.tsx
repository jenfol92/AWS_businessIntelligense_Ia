"use client";

import { Button } from "@tremor/react";
import {
  ExternalLink,
  Folder,
  Layers,
  Pencil,
  Settings,
  Upload,
  User,
} from "lucide-react";
import type {
  ProductDetailResponse,
  ProductDetailSibling,
  ProductDetailVariante,
} from "../../types/product-detail.types";
import { AddVariantActions } from "../AddVariantActions";
import {
  asRecord,
  imageUrlFromDetalle,
  strField,
} from "./safeDetalle";

type ProductDetailHeroSectionProps = {
  data: ProductDetailResponse;
  productId: string;
  onBack: () => void;
  onEdit: () => void;
  onReload: () => void;
  onNavigateToParent: (parentId: string) => void;
  onSelectVariant: (id: string) => void;
  onScrollToLower: () => void;
  onScrollToDocuments: () => void;
  onManageDocuments: () => void;
};

function formatEuro(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value));
}

function formatMarginPercent(raw: unknown): string {
  if (raw == null) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  const pct = n > 0 && n <= 1 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

function formatLastOrder(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === "") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function buildVariantThumbList(
  productId: string,
  currentNombre: string,
  currentImage: string | null,
  currentColor: string | null,
  variantes: ProductDetailVariante[],
  siblings: ProductDetailSibling[],
): Array<{
  id: string;
  nombre: string;
  imagenUrl: string | null;
  color: string | null;
}> {
  const map = new Map<
    string,
    { id: string; nombre: string; imagenUrl: string | null; color: string | null }
  >();
  map.set(productId, {
    id: productId,
    nombre: currentNombre,
    imagenUrl: currentImage,
    color: currentColor,
  });
  for (const v of variantes) {
    map.set(v.id, {
      id: v.id,
      nombre: v.nombre,
      imagenUrl: v.imagenUrl,
      color: v.color,
    });
  }
  for (const s of siblings) {
    if (!map.has(s.id)) {
      map.set(s.id, {
        id: s.id,
        nombre: s.nombre,
        imagenUrl: s.imagenUrl,
        color: s.color,
      });
    }
  }
  const current = map.get(productId);
  const rest = Array.from(map.values()).filter((x) => x.id !== productId);
  const ordered = current ? [current, ...rest] : [...rest];
  return ordered.slice(0, 4);
}

export function ProductDetailHeroSection({
  data,
  productId,
  onBack,
  onEdit,
  onReload,
  onNavigateToParent,
  onSelectVariant,
  onScrollToLower,
  onScrollToDocuments,
  onManageDocuments,
}: ProductDetailHeroSectionProps) {
  const p = asRecord(data.producto);
  const d = asRecord(data.detalle);
  const prov = asRecord(data.proveedor);
  const rent = data.rentabilidad;
  const parent = data.parent;

  const nombre =
    strField(p, "nombre") ?? strField(d, "nombre") ?? "Producto";
  const imagen = imageUrlFromDetalle(data.detalle);
  const sku = strField(p, "sku");
  const asin = strField(p, "asin");
  const ean = strField(p, "ean") ?? strField(d, "ean");
  const codigoSecundario = asin ?? ean ?? null;

  const categoriaObj = asRecord(d?.categoria);
  const categoria =
    strField(categoriaObj, "nombre") ??
    strField(d, "categoria_nombre") ??
    strField(d, "categoria");

  const proveedorNombre = strField(prov, "nombre");
  const puerto = strField(prov, "puerto_preferido");
  const ubicacionLinea = [
    categoria,
    proveedorNombre,
    puerto ? `Puerto ${puerto}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const lastOrdered = formatLastOrder(
    strField(p, "last_ordered_at") ?? undefined,
  );

  const precioVenta =
    rent.precio_venta_objetivo != null
      ? Number(rent.precio_venta_objetivo)
      : data.precioEfectivo?.precioVentaBase ?? null;

  const costeUnitario =
    rent.coste_unitario != null ? Number(rent.coste_unitario) : null;
  const margenLabel = formatMarginPercent(rent.margen_bruto_porcentaje);

  const colorActual = strField(d, "color");

  const thumbs = buildVariantThumbList(
    productId,
    nombre,
    imagen,
    colorActual,
    data.variantes,
    data.siblings,
  );

  const hasSeveralVariants = thumbs.length > 1;

  const documentos = data.documentos ?? [];
  const docCount = documentos.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onBack}
          className="w-fit text-left text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
        >
          ← Volver al catálogo
        </button>
        <button
          type="button"
          onClick={onReload}
          className="w-fit text-left text-xs text-slate-500 hover:text-slate-700 sm:text-right"
        >
          Actualizar datos
        </button>
      </div>

      {parent?.id ? (
        <div className="rounded-2xl border border-blue-100/80 bg-gradient-to-br from-blue-50/90 to-sky-50/70 px-4 py-4 shadow-sm sm:px-6 sm:py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/80 text-blue-600 shadow-sm ring-1 ring-blue-100">
                <Layers className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-600">
                  Variante de
                </p>
                <p className="mt-1 truncate text-lg font-bold text-slate-900 sm:text-xl">
                  {[parent.sku, parent.nombre].filter(Boolean).join(" · ") ||
                    "Producto padre"}
                </p>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-blue-900/80">
                  Esta variante hereda el precio, proveedor, categoría, ficha
                  técnica, logística, costes y documentos del padre (editables
                  individualmente).
                </p>
              </div>
            </div>
            <AddVariantActions
              productId={productId}
              parentId={parent.id}
              layout="hero"
              className="w-full lg:max-w-md"
            />
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-md ring-1 ring-slate-100/80">
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-12">
          {/* Column 1 — Imagen */}
          <div className="border-b border-slate-100 p-5 lg:col-span-3 lg:border-b-0 lg:border-r">
            <div className="relative mx-auto aspect-square max-w-[280px] overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100">
              {imagen ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagen}
                    alt={nombre}
                    className="h-full w-full object-contain p-3"
                  />
                  <div className="absolute left-3 top-3 h-14 w-14 overflow-hidden rounded-lg border border-white shadow-md ring-1 ring-slate-200/80">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagen}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  Sin imagen
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
              >
                <Pencil className="h-4 w-4" />
                Editar producto
              </button>
              <button
                type="button"
                onClick={onScrollToLower}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-blue-600 shadow-sm transition hover:bg-slate-50"
              >
                Ver más detalles
              </button>
            </div>
          </div>

          {/* Column 2 — Información */}
          <div className="border-b border-slate-100 p-5 lg:col-span-5 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap gap-2">
              {sku ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {sku}
                </span>
              ) : null}
              {codigoSecundario ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-mono text-slate-600">
                  {codigoSecundario}
                </span>
              ) : null}
            </div>

            <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {nombre}
            </h1>

            {parent?.id && parent.nombre ? (
              <button
                type="button"
                onClick={() => onNavigateToParent(parent.id)}
                className="mt-2 text-sm font-medium text-slate-500 transition hover:text-blue-600"
              >
                ← Volver al padre: {parent.nombre}
              </button>
            ) : null}

            {hasSeveralVariants ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {thumbs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.nombre || "Ver variante"}
                    aria-label={t.nombre || "Ver variante"}
                    onClick={() =>
                      t.id === productId ? undefined : onSelectVariant(t.id)
                    }
                    className={`group relative flex flex-col items-center gap-1 transition ${
                      t.id === productId ? "opacity-100" : "opacity-90 hover:opacity-100"
                    }`}
                  >
                    <span
                      className={`relative h-12 w-12 overflow-hidden rounded-full border-2 bg-slate-100 ${
                        t.id === productId
                          ? "border-blue-600 ring-2 ring-blue-200"
                          : "border-transparent group-hover:ring-2 group-hover:ring-slate-200"
                      }`}
                    >
                      {t.imagenUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={t.imagenUrl}
                          alt={t.nombre}
                          className="h-full w-full object-cover"
                        />
                      ) : t.color ? (
                        <span
                          className="block h-full w-full"
                          style={{ backgroundColor: t.color }}
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
                          ···
                        </span>
                      )}
                    </span>
                    {t.nombre ? (
                      <span className="max-w-[72px] truncate text-[10px] text-slate-500 opacity-0 transition group-hover:opacity-100">
                        {t.nombre}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-6 border-t border-slate-100 pt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Último pedido
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {lastOrdered}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {ubicacionLinea || "—"}
              </p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Precio de venta
                </p>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {formatEuro(precioVenta)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Coste unitario
                </p>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {formatEuro(costeUnitario)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Margen bruto
                </p>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {margenLabel}
                </p>
              </div>
            </div>

            {parent == null ? (
              <div className="mt-4 flex justify-end">
                <AddVariantActions productId={productId} layout="compact" />
              </div>
            ) : null}
          </div>

          {/* Column 3 — Documentación */}
          <div className="p-5 lg:col-span-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Checklist técnico
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">
              Documentación (Drive)
            </h2>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onManageDocuments}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <Upload className="h-4 w-4 text-slate-500" />
                Añadir archivo
              </button>
              <button
                type="button"
                onClick={onManageDocuments}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <Settings className="h-4 w-4 text-slate-500" />
                Gestionar documentación
              </button>
            </div>

            <p className="mt-2 text-xs text-slate-500">
              PDF, imágenes, Excel/CSV · máx. 30 MB
            </p>

            <div className="mt-5 space-y-3">
              <div className="rounded-xl border border-amber-100/90 bg-amber-50/40 p-3">
                <div className="flex gap-2">
                  <Folder className="h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Compartidos (carpeta padre)
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">
                      Sin documentos compartidos todavía.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-violet-100/90 bg-violet-50/35 p-3">
                <div className="flex gap-2">
                  <User className="h-5 w-5 shrink-0 text-violet-600" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Individuales (esta variante)
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">
                      {docCount === 0
                        ? "Sin documentos en la subcarpeta del SKU."
                        : `${docCount} documento${docCount === 1 ? "" : "s"} vinculado${docCount === 1 ? "" : "s"} — ver lista abajo.`}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onScrollToDocuments}
              className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir sección documentos
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
