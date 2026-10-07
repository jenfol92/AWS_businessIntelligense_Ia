// modules/products/components/ProductCatalogRow.tsx



"use client";



import { useRouter } from "next/navigation";

import type { ProductCatalogItem } from "../types/catalog.types";
import { ProductCatalogFbmStock } from "./ProductCatalogFbmStock";

import { ResponsiveDataCard } from "@/shared/ui/ResponsiveDataCard";



type ProductCatalogRowProps = {

  row: ProductCatalogItem;

};



function formatCurrency(value: number | null) {

  if (value === null) return "—";



  return new Intl.NumberFormat("es-ES", {

    style: "currency",

    currency: "EUR",

    maximumFractionDigits: 2,

  }).format(value);

}



function formatPercent(value: number | null) {

  if (value === null) return "—";



  const normalized = Math.abs(value) <= 1 ? value * 100 : value;

  return `${normalized.toFixed(1)}%`;

}



function formatNumber(value: number | null) {

  if (value === null) return "—";



  return new Intl.NumberFormat("es-ES", {

    maximumFractionDigits: 0,

  }).format(value);

}



function getRiskBadgeClass(risk: string | null) {

  if (risk === "critico") return "bg-red-100 text-red-700 ring-red-200";

  if (risk === "alto") return "bg-orange-100 text-orange-700 ring-orange-200";

  if (risk === "medio") return "bg-blue-100 text-blue-700 ring-blue-200";

  if (risk === "bajo") return "bg-emerald-100 text-emerald-700 ring-emerald-200";

  return "bg-slate-100 text-slate-600 ring-slate-200";

}



export function ProductCatalogRow({ row }: ProductCatalogRowProps) {

  const router = useRouter();



  return (

    <tr className="transition hover:bg-slate-50">

      <td className="px-5 py-4">

        <div className="flex items-center gap-4">

          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">

            {row.imagenUrl ? (

              // eslint-disable-next-line @next/next/no-img-element

              <img

                src={row.imagenUrl}

                alt={row.nombre}

                className="h-full w-full object-contain p-1"

              />

            ) : (

              <span className="text-xs text-slate-400">—</span>

            )}

          </div>



          <div className="min-w-0">

            <div className="max-w-[300px] truncate text-sm font-semibold text-slate-900">

              {row.nombre}

            </div>



            <div className="mt-0.5 max-w-[300px] truncate text-xs text-slate-500">

              {row.sku}

              {row.asin ? ` · ${row.asin}` : ""}

            </div>



            <div className="mt-1 max-w-[300px] truncate text-xs text-slate-500">

              {row.proveedorNombre ?? "Sin proveedor"}

            </div>



            <div className="max-w-[300px] truncate text-xs text-slate-400">

              Agente: {row.agenteEmpresa ?? "Sin agente"}

            </div>

          </div>

        </div>

      </td>



      <td className="px-4 py-3 text-slate-700">{row.categoria}</td>



      <td className="px-4 py-3 text-slate-700">

        {row.puertoPreferido?.trim() ? row.puertoPreferido : "Puerto pendiente"}

      </td>



      <td className="px-4 py-3 text-right">

        <div className="font-medium text-slate-900">{formatNumber(row.stockTotal)}</div>

        <div className="text-xs text-slate-500">

          FBA {row.stockFba} · <ProductCatalogFbmStock stock={row.publishedFbm} />

        </div>

      </td>



      <td className="px-5 py-4 text-right text-slate-700">

        {row.diasCobertura != null ? `${Math.round(row.diasCobertura)} días` : "—"}

      </td>



      <td className="px-5 py-4 text-right text-slate-700">

        {formatCurrency(row.precioVentaObjetivo)}

      </td>



      <td className="px-5 py-4 text-right text-slate-700">

        {formatCurrency(row.costeTotalEstimado)}

      </td>



      <td className="px-5 py-4 text-right font-medium text-slate-900">

        {formatPercent(row.margenEstimado)}

      </td>



      <td className="px-5 py-4 text-right text-slate-700">{formatPercent(row.acos30d)}</td>



      <td className="px-5 py-4">

        <span

          className={[

            "inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1",

            getRiskBadgeClass(row.riesgo),

          ].join(" ")}

        >

          {row.riesgo ?? "sin dato"}

        </span>

      </td>



      <td className="px-5 py-4 text-right">

        <button

          type="button"

          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"

          onClick={() => router.push(`/productos/${row.id}`)}

        >

          Ver

        </button>

      </td>

    </tr>

  );

}



export function ProductCatalogMobileCard({ row }: ProductCatalogRowProps) {

  const router = useRouter();



  return (

    <ResponsiveDataCard

      title={row.nombre}

      subtitle={

        <>

          {row.sku}

          {row.asin ? ` · ${row.asin}` : ""}

        </>

      }

      badges={

        <span

          className={[

            "inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1",

            getRiskBadgeClass(row.riesgo),

          ].join(" ")}

        >

          {row.riesgo ?? "sin dato"}

        </span>

      }

      fields={[

        { label: "Categoría", value: row.categoria },

        {

          label: "Puerto",

          value: row.puertoPreferido?.trim() ? row.puertoPreferido : "Puerto pendiente",

        },

        {

          label: "Stock",

          value: (

            <>

              {formatNumber(row.stockTotal)}{" "}

              <span className="text-xs text-slate-500">

                (FBA {row.stockFba} · <ProductCatalogFbmStock stock={row.publishedFbm} />)

              </span>

            </>

          ),

        },

        {

          label: "Cobertura",

          value:

            row.diasCobertura != null ? `${Math.round(row.diasCobertura)} días` : "—",

        },

        { label: "Precio", value: formatCurrency(row.precioVentaObjetivo) },

        { label: "Coste", value: formatCurrency(row.costeTotalEstimado) },

        { label: "Margen", value: formatPercent(row.margenEstimado) },

        { label: "ACOS", value: formatPercent(row.acos30d) },

      ]}

      footer={

        <>

          {row.proveedorNombre ?? "Sin proveedor"}

          {row.agenteEmpresa ? ` · Agente: ${row.agenteEmpresa}` : ""}

        </>

      }

      actions={

        <button

          type="button"

          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"

          onClick={() => router.push(`/productos/${row.id}`)}

        >

          Ver producto

        </button>

      }

    />

  );

}

