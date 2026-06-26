"use client";



import { AddVariantActions } from "../../AddVariantActions";

import type { useProductForm } from "../../../hooks/useProductForm";

import { pfCard, pfCardBody, pfCardHeader, pfCardTitle } from "../productFormUi";



type Props = {

  form: ReturnType<typeof useProductForm>;

};



/** Relación padre/variante, herencia de precio y acciones para crear variantes. */

export function ProductFormVariantsPanel({ form }: Props) {

  const { values, updateField, isVariant, parentSummary, isEditMode, productId } = form;



  return (

    <div className="space-y-6">

      {isEditMode && productId ? (

        <section className={pfCard}>

          <div className={pfCardHeader}>

            <h2 className={pfCardTitle}>Crear otra variante</h2>

          </div>

          <div className={pfCardBody}>

            <AddVariantActions

              productId={productId}

              parentId={values.parentId || null}

              layout="panel"

            />

          </div>

        </section>

      ) : null}



      {!isVariant && !values.parentId && !isEditMode ? (

        <section className={pfCard}>

          <div className={pfCardBody}>

            <p className="text-sm text-slate-600">

              Este producto no es una variante. Al guardarlo podrás crear variantes

              hijas desde esta pestaña o desde la ficha del producto.

            </p>

          </div>

        </section>

      ) : null}



      {isVariant || values.parentId ? (

        <section className={pfCard}>

          <div className={pfCardHeader}>

            <h2 className={pfCardTitle}>Variante y herencia</h2>

          </div>

          <div className={pfCardBody}>

            {parentSummary ? (

              <dl className="grid gap-3 text-sm sm:grid-cols-2">

                <div>

                  <dt className="text-xs uppercase text-slate-500">Padre SKU</dt>

                  <dd className="font-medium text-slate-800">{parentSummary.sku}</dd>

                </div>

                <div>

                  <dt className="text-xs uppercase text-slate-500">Padre nombre</dt>

                  <dd className="font-medium text-slate-800">{parentSummary.nombre}</dd>

                </div>

              </dl>

            ) : (

              <p className="text-sm text-slate-500">ID padre: {values.parentId}</p>

            )}



            <label className="mt-6 flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">

              <input

                type="checkbox"

                className="h-4 w-4 rounded border-slate-300 text-blue-600"

                checked={values.heredarPrecio}

                onChange={(e) => updateField("heredarPrecio", e.target.checked)}

              />

              <span className="text-sm text-slate-700">

                Heredar precio de venta del padre (desmarca para fijar precio propio)

              </span>

            </label>

            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">

              <input

                type="checkbox"

                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"

                checked={values.heredarCosteUnitarioTotal}

                onChange={(e) =>
                  updateField("heredarCosteUnitarioTotal", e.target.checked)
                }

              />

              <span className="text-sm text-slate-700">

                <span className="block">
                  Heredar coste unitario total del padre
                </span>
                <span className="block text-xs text-slate-500">
                  Usa el coste unitario total del producto padre para esta variante.
                </span>

              </span>

            </label>

          </div>

        </section>

      ) : null}

    </div>

  );

}

