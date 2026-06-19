/**

 * Módulo  : products

 * Archivo : AddVariantActions.tsx

 * Qué hace: Acciones para crear variantes con rutas y herencia claras (padre vs hijo).

 * NO debe: Persistir datos ni alterar la lógica de buildVariantFormFromParent.

 */



"use client";



import Link from "next/link";

import { useParams } from "next/navigation";

import { Plus } from "lucide-react";

import { twMerge } from "tailwind-merge";

import { DEFAULT_LOCALE, isLocale } from "@/config/i18n";



type AddVariantActionsProps = {

  productId: string;

  /** Si existe, el producto actual es variante/hijo del padre indicado. */

  parentId?: string | null;

  layout?: "banner" | "hero" | "compact" | "panel";

  className?: string;

};



function resolveLocale(raw: string | string[] | undefined): string {

  const value = Array.isArray(raw) ? raw[0] : raw;

  return isLocale(value) ? value : DEFAULT_LOCALE;

}



/** Ruta de alta de variante; `parent_id` define padre en BD y base de herencia. */

export function buildNewVariantHref(locale: string, parentId: string): string {

  return `/${locale}/productos/new?parent_id=${encodeURIComponent(parentId)}`;

}



export function isVariantProduct(parentId: string | null | undefined): boolean {

  return Boolean(parentId?.trim());

}



export function AddVariantActions({

  productId,

  parentId,

  layout = "panel",

  className,

}: AddVariantActionsProps) {

  const params = useParams();

  const locale = resolveLocale(params.locale);

  const isChild = isVariantProduct(parentId);

  const parentIdResolved = parentId?.trim() ?? "";



  const singleHref = buildNewVariantHref(locale, productId);

  const siblingHref = parentIdResolved

    ? buildNewVariantHref(locale, parentIdResolved)

    : singleHref;

  const childHref = buildNewVariantHref(locale, productId);



  if (!isChild) {

    const btnClass =

      layout === "banner"

        ? "inline-flex min-h-10 items-center justify-center rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-100/60"

        : layout === "hero"

          ? "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"

          : layout === "compact"

            ? "inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-slate-50"

            : "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50";



    return (

      <Link href={singleHref} className={twMerge(btnClass, className)}>

        <Plus className="h-4 w-4 shrink-0" aria-hidden />

        Añadir variante

      </Link>

    );

  }



  const hint = (

    <p

      className={twMerge(

        "text-slate-600",

        layout === "banner" ? "text-sm text-emerald-800" : "text-xs",

      )}

    >

      Si quieres crear otro color de la misma familia, usa{" "}

      <span className="font-semibold">«Crear variante del padre»</span>.

    </p>

  );



  const primaryClass =

    layout === "banner"

      ? "rounded-lg border-2 border-emerald-500 bg-white px-4 py-3 text-left shadow-sm transition hover:bg-emerald-50/80"

      : layout === "hero"

        ? "rounded-xl border-2 border-blue-500 bg-white px-4 py-3 text-left shadow-sm transition hover:bg-blue-50/50"

        : "rounded-xl border-2 border-blue-500 bg-blue-50/40 px-4 py-3 text-left transition hover:bg-blue-50/70";



  const secondaryClass =

    layout === "banner"

      ? "rounded-lg border border-emerald-300 bg-white px-4 py-3 text-left shadow-sm transition hover:bg-emerald-100/40"

      : "rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:bg-slate-50";



  return (

    <div className={twMerge("space-y-3", className)}>

      {hint}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">

        <Link href={siblingHref} className={twMerge(primaryClass, "min-w-0 flex-1 sm:min-w-[14rem]")}>

          <span className="block text-sm font-semibold text-slate-900">

            Crear variante del padre

          </span>

          <span className="mt-1 block text-xs leading-snug text-slate-600">

            Crea otro color/modelo hermano usando como base el producto padre.

          </span>

          <span className="mt-2 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-800">

            Recomendado

          </span>

        </Link>

        <Link href={childHref} className={twMerge(secondaryClass, "min-w-0 flex-1 sm:min-w-[14rem]")}>

          <span className="block text-sm font-semibold text-slate-900">

            Crear variante de este producto

          </span>

          <span className="mt-1 block text-xs leading-snug text-slate-600">

            Crea una variante hija tomando este producto como base.

          </span>

        </Link>

      </div>

    </div>

  );

}

