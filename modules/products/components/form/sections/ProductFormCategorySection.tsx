"use client";

import type { useProductForm } from "../../../hooks/useProductForm";
import { ProductFieldRenderer } from "../ProductFieldRenderer";
import { NewCategoryModal } from "../NewCategoryModal";
import { InheritanceOverrideControl } from "../InheritanceOverrideControl";
import {
  pfCard,
  pfCardBody,
  pfCardHeader,
  pfCardTitle,
  pfFieldClass,
  pfGrid,
  pfLabel,
  pfSpan2,
} from "../productFormUi";

type Props = {
  form: ReturnType<typeof useProductForm>;
  /** select = solo categoría; dynamic = campos campos_config; all = ambos */
  mode?: "select" | "dynamic" | "all";
};

export function ProductFormCategorySection({ form, mode = "all" }: Props) {
  const {
    values,
    errors,
    isEditMode,
    categories,
    loadingCategories,
    categoryFormFields,
    pendingCategoryFields,
    selectedCategory,
    setCategoryId,
    updateCategoryDynamicField,
    createCategoryAndSelect,
    showNewCategoryModal,
    setShowNewCategoryModal,
  } = form;

  const showSelect = mode === "select" || mode === "all";
  const showDynamic = mode === "dynamic" || mode === "all";
  const pendingKeys = new Set(pendingCategoryFields.map((f) => f.key));

  const dynamicFieldsIntro = categoryFormFields.length > 0 ? (
    !isEditMode ? (
      <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Puedes completar las características técnicas más adelante.
      </p>
    ) : pendingCategoryFields.length > 0 ? (
      <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Características técnicas pendientes:{" "}
        {pendingCategoryFields.map((f) => f.label).join(", ")}.
      </p>
    ) : null
  ) : null;

  const renderDynamicField = (field: (typeof categoryFormFields)[number]) => (
    <div
      key={field.key}
      className={field.type === "textarea" ? "md:col-span-2" : undefined}
    >
      <ProductFieldRenderer
        field={field}
        value={values.categoryDynamicFields[field.key] ?? null}
        onChange={(v) => updateCategoryDynamicField(field.key, v)}
        requiredIndicator={field.required ? "informative" : "none"}
        inherited={form.isVariant && values.inheritanceOverrides.categorySpecifications[field.key] !== true}
        inheritedValue={form.parentValues?.categoryDynamicFields[field.key]}
      />
      {form.isVariant ? (
        <button
          type="button"
          className="mt-1 text-xs font-medium text-blue-700 hover:underline"
          onClick={() => values.inheritanceOverrides.categorySpecifications[field.key]
            ? form.inheritCategorySpecificationFromParent(field.key)
            : form.personalizeCategorySpecification(field.key)}
        >
          {values.inheritanceOverrides.categorySpecifications[field.key]
            ? "Volver a heredar"
            : "Personalizar"}
        </button>
      ) : null}
      {errors.dynamicFields?.[field.key] ? (
        <p className="mt-1 text-xs text-red-600">
          {errors.dynamicFields[field.key]}
        </p>
      ) : pendingKeys.has(field.key) ? (
        <p className="mt-1 text-xs text-amber-700">Pendiente de completar</p>
      ) : null}
    </div>
  );

  return (
    <>
      {showSelect ? (
      <section className={pfCard} aria-labelledby="product-section-category">
        <div className={pfCardHeader}>
          <h2 id="product-section-category" className={pfCardTitle}>
            Categoría
          </h2>
          {selectedCategory?.descripcion ? (
            <p className="mt-1 text-sm text-slate-500">
              {selectedCategory.descripcion}
            </p>
          ) : null}
        </div>
        <div className={pfCardBody}>
          <div className={pfGrid}>
            <div className={pfSpan2}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label className={pfLabel} htmlFor="pf-categoria-id">
                    Categoría *
                  </label>
                  <select
                    id="pf-categoria-id"
                    className={pfFieldClass(Boolean(errors.categoriaId))}
                    value={values.categoriaId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    disabled={loadingCategories}
                  >
                    <option value="">Seleccionar categoría…</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.nombre}
                      </option>
                    ))}
                  </select>
                  <InheritanceOverrideControl form={form} field="categoriaId" />
                  {errors.categoriaId ? (
                    <p className="mt-1 text-xs text-red-600">
                      {errors.categoriaId}
                    </p>
                  ) : null}
                  {loadingCategories ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Cargando categorías…
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setShowNewCategoryModal(true)}
                  className="shrink-0 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  Nueva categoría
                </button>
              </div>
            </div>
          </div>

          {showDynamic && categoryFormFields.length > 0 ? (
            <div className="mt-6 border-t border-slate-100 pt-6">
              <h3 className="mb-4 text-sm font-semibold text-slate-700">
                Campos específicos de la categoría
              </h3>
              {dynamicFieldsIntro}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {categoryFormFields.map(renderDynamicField)}
              </div>
            </div>
          ) : showDynamic && values.categoriaId ? (
            <p className="mt-4 text-sm text-slate-500">
              Esta categoría no define campos dinámicos adicionales.
            </p>
          ) : null}
        </div>
      </section>
      ) : null}

      {showDynamic && !showSelect && categoryFormFields.length > 0 ? (
        <section className={pfCard} aria-labelledby="product-section-category-dynamic">
          <div className={pfCardHeader}>
            <h2 id="product-section-category-dynamic" className={pfCardTitle}>
              Especificaciones de categoría
            </h2>
          </div>
          <div className={pfCardBody}>
            {dynamicFieldsIntro}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {categoryFormFields.map(renderDynamicField)}
            </div>
          </div>
        </section>
      ) : null}

      {showSelect && showNewCategoryModal ? (
        <NewCategoryModal
          onClose={() => setShowNewCategoryModal(false)}
          onCreated={createCategoryAndSelect}
        />
      ) : null}
    </>
  );
}
