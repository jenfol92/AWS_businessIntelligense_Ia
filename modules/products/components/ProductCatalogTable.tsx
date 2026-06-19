// modules/products/components/ProductCatalogTable.tsx



import type { ProductCatalogItem } from "../types/catalog.types";

import { ProductCatalogMobileCard, ProductCatalogRow } from "./ProductCatalogRow";

import { ResponsiveTable } from "@/shared/ui/ResponsiveTable";



type ProductCatalogTableProps = {

  rows: ProductCatalogItem[];

  totalRows: number;

  loading: boolean;

  showAll: boolean;

  hasHiddenRows: boolean;

  onShowAll: () => void;

  onShowLess: () => void;

};



function ListFooter({

  rowsLength,

  totalRows,

  hasHiddenRows,

  showAll,

  onShowAll,

  onShowLess,

}: Pick<

  ProductCatalogTableProps,

  "totalRows" | "hasHiddenRows" | "showAll" | "onShowAll" | "onShowLess"

> & { rowsLength: number }) {

  return (

    <>

      {hasHiddenRows ? (

        <div className="flex justify-end border-b border-slate-100 px-4 py-3 lg:border-b-0 lg:px-5 lg:py-0 lg:pb-0">

          <button

            type="button"

            onClick={showAll ? onShowLess : onShowAll}

            className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"

          >

            {showAll ? "Ver solo 12" : "Ver todos"}

          </button>

        </div>

      ) : null}

      <div className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-500 lg:px-5">

        Mostrando {rowsLength} de {totalRows} productos

      </div>

    </>

  );

}



export function ProductCatalogTable({

  rows,

  totalRows,

  loading,

  showAll,

  hasHiddenRows,

  onShowAll,

  onShowLess,

}: ProductCatalogTableProps) {

  if (loading) {

    return (

      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">

        Cargando catálogo...

      </div>

    );

  }



  if (rows.length === 0) {

    return (

      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">

        No hay productos para mostrar.

      </div>

    );

  }



  return (

    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4 sm:px-5">

        <div>

          <p className="text-sm font-medium text-slate-900">

            Listado de productos

          </p>

          <p className="hidden text-xs text-slate-500 lg:block">

            Mostrando {rows.length} de {totalRows} productos

          </p>

        </div>



        {hasHiddenRows ? (

          <button

            type="button"

            onClick={showAll ? onShowLess : onShowAll}

            className="hidden min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 lg:inline-flex lg:items-center"

          >

            {showAll ? "Ver solo 12" : "Ver todos"}

          </button>

        ) : null}

      </div>



      <ResponsiveTable

        desktop={

          <div className="overflow-x-auto">

            <table className="min-w-[1350px] w-full divide-y divide-slate-200 text-sm">

              <thead className="bg-slate-50">

                <tr>

                  <th className="w-[420px] px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">

                    Producto

                  </th>

                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">

                    Categoría

                  </th>

                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">

                    Puerto

                  </th>

                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">

                    Stock

                  </th>

                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">

                    Cobertura

                  </th>

                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">

                    Precio

                  </th>

                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">

                    Coste

                  </th>

                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">

                    Margen

                  </th>

                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">

                    ACOS

                  </th>

                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">

                    Riesgo

                  </th>

                  <th className="px-5 py-3" />

                </tr>

              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">

                {rows.map((row) => (

                  <ProductCatalogRow key={row.id} row={row} />

                ))}

              </tbody>

            </table>

          </div>

        }

        mobile={

          <div className="space-y-3 p-4">

            {rows.map((row) => (

              <ProductCatalogMobileCard key={row.id} row={row} />

            ))}

          </div>

        }

      />



      <div className="lg:hidden">

        <ListFooter

          rowsLength={rows.length}

          totalRows={totalRows}

          hasHiddenRows={hasHiddenRows}

          showAll={showAll}

          onShowAll={onShowAll}

          onShowLess={onShowLess}

        />

      </div>

    </div>

  );

}


