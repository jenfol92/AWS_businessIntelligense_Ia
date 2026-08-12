// modules/products/hooks/useProductForm.ts



"use client";



import { useCallback, useEffect, useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { EMPTY_PRODUCT_FORM } from "../constants";

import {

  createProductRequest,

  fetchAmazonMarketplacesCatalog,

  fetchProductFormById,

  fetchProductFormCategories,

  fetchProductFormSuppliers,

  createProductCategory,

  uploadProductFormImage,

  updateProductRequest,

} from "../services/productFormClient";

import {
  fetchProductDocuments,
  uploadProductDocumentApi,
  deleteProductDocumentApi,
} from "../services/productDocumentClient";

import { mapCategoryCamposToFormFields } from "@/modules/categories/mappers/categoryFieldMapper";
import { getPendingCategoryDynamicFields } from "../utils/categoryDynamicFields";
import { buildVariantFormFromParent } from "../utils/variantFormTemplate";
import { PRODUCT_INHERITABLE_FIELDS } from "../types/product-inheritance.types";
import type { ProductInheritableField } from "../types/product-inheritance.types";

import {

  hasProductFormErrors,

  validateProductForm,

} from "../schemas/productSchema";

import type {
  AmazonMarketplaceCatalog,
  AmazonMarketplaceContentDraft,
  ProductCategoryOption,
  ProductFormDocumentRow,
  ProductFormErrors,
  ProductFormFieldValue,
  ProductFormMode,
  ProductFormValues,
  ProductSupplierLogisticsInfo,
  ProductSupplierOption,
} from "../types";

import { createDefaultAmazonMarketplaceDraft } from "../constants/amazonMarketplaceDefaults";



type UseProductFormParams = {

  mode: ProductFormMode;

  productId?: string;

  /** `parent_id` desde query (?parent_id=) al crear variante. */

  variantParentId?: string | null;

};



// Este hook contiene el estado del formulario.

// La UI no sabe guardar, cargar ni validar directamente.

export function useProductForm({

  mode,

  productId,

  variantParentId,

}: UseProductFormParams) {

  const router = useRouter();



  const [values, setValues] =

    useState<ProductFormValues>(EMPTY_PRODUCT_FORM);



  const [errors, setErrors] = useState<ProductFormErrors>({});

  const [loading, setLoading] = useState(
    mode === "edit" || Boolean(variantParentId?.trim()),
  );

  const [saving, setSaving] = useState(false);

  const [uploadingImage, setUploadingImage] = useState(false);

  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalWarning, setGlobalWarning] = useState<string | null>(null);

  const [amazonCatalog, setAmazonCatalog] = useState<

    AmazonMarketplaceCatalog[]

  >([]);

  const [catalogLoading, setCatalogLoading] = useState(true);



  const [suppliers, setSuppliers] = useState<ProductSupplierOption[]>([]);

  const [loadingSuppliers, setLoadingSuppliers] = useState(true);

  const [categories, setCategories] = useState<ProductCategoryOption[]>([]);

  const [loadingCategories, setLoadingCategories] = useState(true);

  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);

  const [parentSummary, setParentSummary] = useState<{
    sku: string;
    nombre: string;
  } | null>(null);
  const [variantCount, setVariantCount] = useState(0);
  const [parentValues, setParentValues] = useState<ProductFormValues | null>(null);

  const [documents, setDocuments] = useState<ProductFormDocumentRow[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);

  const isEditMode = mode === "edit";

  const productIdResolved = productId ?? values.id;

  const isVariant = Boolean(
    values.parentId.trim() || variantParentId?.trim(),
  );

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === values.categoriaId) ?? null,
    [categories, values.categoriaId],
  );

  const categoryFormFields = useMemo(
    () => mapCategoryCamposToFormFields(selectedCategory?.campos_config),
    [selectedCategory],
  );

  const pendingCategoryFields = useMemo(
    () =>
      getPendingCategoryDynamicFields(
        categoryFormFields,
        values.categoryDynamicFields,
      ),
    [categoryFormFields, values.categoryDynamicFields],
  );

  const selectedSupplierLogistics = useMemo((): ProductSupplierLogisticsInfo | null => {
    if (!values.proveedorId.trim()) return null;
    const s = suppliers.find((x) => x.id === values.proveedorId);
    if (!s) return null;
    return {
      diasProduccionEstandar: s.diasProduccionEstandar ?? null,
      diasTransitoEstandar: s.diasTransitoEstandar ?? null,
      puertoPreferidoNombre: s.puertoPreferidoNombre ?? null,
      agenteContacto: s.agenteContacto ?? null,
    };
  }, [values.proveedorId, suppliers]);

  const title = useMemo(() => {

    return isEditMode ? "Editar producto" : "Nuevo producto";

  }, [isEditMode]);



  useEffect(() => {

    async function loadCatalog() {

      try {

        setCatalogLoading(true);

        const rows = await fetchAmazonMarketplacesCatalog();

        setAmazonCatalog(rows);

      } catch {

        setAmazonCatalog([]);

      } finally {

        setCatalogLoading(false);

      }

    }

    void loadCatalog();

  }, []);



  useEffect(() => {
    let cancelled = false;

    async function loadSuppliers() {
      try {
        setLoadingSuppliers(true);
        const supRows = await fetchProductFormSuppliers();
        if (!cancelled) {
          setSuppliers(supRows);
          if (process.env.NODE_ENV === "development") {
            console.debug("[useProductForm] suppliers in state:", supRows.length);
          }
        }
      } catch {
        if (!cancelled) {
          setSuppliers([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingSuppliers(false);
        }
      }
    }

    void loadSuppliers();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      try {
        setLoadingCategories(true);
        const catRows = await fetchProductFormCategories();
        if (!cancelled) {
          setCategories(catRows);
          if (process.env.NODE_ENV === "development") {
            console.debug(
              "[useProductForm] categories in state:",
              catRows.length,
            );
          }
        }
      } catch {
        if (!cancelled) {
          setCategories([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingCategories(false);
        }
      }
    }

    void loadCategories();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Sincroniza claves activas al cargar edición o cuando llegan categorías. */
  useEffect(() => {
    if (!values.categoriaId || categories.length === 0) return;
    const cat = categories.find((c) => c.id === values.categoriaId);
    if (!cat) return;
    const keys = mapCategoryCamposToFormFields(cat.campos_config).map(
      (f) => f.key,
    );
    setValues((current) => {
      const sameKeys =
        current.categoryActiveFieldKeys.length === keys.length &&
        current.categoryActiveFieldKeys.every((k, i) => k === keys[i]);
      if (sameKeys && current.categoria) return current;
      return {
        ...current,
        categoryActiveFieldKeys: keys,
        categoria: current.categoria || cat.nombre,
      };
    });
  }, [values.categoriaId, categories]);

  /** Productos legacy: solo nombre de categoría sin UUID. */
  useEffect(() => {
    if (values.categoriaId || !values.categoria.trim() || categories.length === 0) {
      return;
    }
    const match = categories.find(
      (c) => c.nombre.toLowerCase() === values.categoria.trim().toLowerCase(),
    );
    if (!match) return;
    setCategoryIdInternal(match.id, { skipConfirm: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo migración legacy
  }, [values.categoriaId, values.categoria, categories]);

  useEffect(() => {
    if (isEditMode) return;
    const pid = variantParentId?.trim();
    if (!pid) return;

    let cancelled = false;

    async function loadParentAsTemplate() {
      try {
        setLoading(true);
        setGlobalError(null);
        const data = await fetchProductFormById(pid);
        if (cancelled) return;
        if (!data.ok || !data.product) {
          setValues((current) => ({ ...current, parentId: pid, heredarPrecio: true }));
          return;
        }

        const parent = data.product;
        setParentValues(parent);
        setParentSummary({ sku: parent.sku, nombre: parent.nombre });
        setValues(buildVariantFormFromParent(parent, pid));
      } catch (error) {
        if (!cancelled) {
          setValues((current) => ({ ...current, parentId: pid, heredarPrecio: true }));
          setGlobalError(
            error instanceof Error
              ? error.message
              : "No se pudo cargar el producto padre para heredar datos",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadParentAsTemplate();
    return () => {
      cancelled = true;
    };
  }, [isEditMode, variantParentId]);



  useEffect(() => {

    if (!isEditMode || !productId) return;



    async function loadProduct() {

      try {

        setLoading(true);

        setGlobalError(null);



        const data = await fetchProductFormById(productId);



        if (!data.ok) {

          throw new Error(
            "error" in data && data.error
              ? data.error
              : "Producto no encontrado",
          );

        }



        setValues(data.product);
        setVariantCount(Number(data.variantCount ?? 0));

        if (data.product.parentId?.trim()) {
          try {
            const parentData = await fetchProductFormById(data.product.parentId);
            if (parentData.ok && parentData.product) {
              setParentValues(parentData.product);
              setParentSummary({
                sku: parentData.product.sku,
                nombre: parentData.product.nombre,
              });
            }
          } catch {
            /* opcional */
          }
        }

      } catch (error) {

        const message =

          error instanceof Error

            ? error.message

            : "Error cargando producto";



        setGlobalError(message);

      } finally {

        setLoading(false);

      }

    }



    void loadProduct();

  }, [isEditMode, productId]);

  useEffect(() => {
    if (!isEditMode || !productId) return;
    let cancelled = false;

    async function loadDocs() {
      try {
        setLoadingDocuments(true);
        setDocumentsError(null);
        const rows = await fetchProductDocuments(productId);
        if (!cancelled) setDocuments(rows);
      } catch (e) {
        if (!cancelled) {
          setDocumentsError(
            e instanceof Error ? e.message : "Error cargando documentos",
          );
        }
      } finally {
        if (!cancelled) setLoadingDocuments(false);
      }
    }

    void loadDocs();
    return () => {
      cancelled = true;
    };
  }, [isEditMode, productId]);

  function orderedAssignedIds(set: Set<string>): string[] {

    const ordered: string[] = [];

    for (const c of amazonCatalog) {

      if (set.has(c.id)) ordered.push(c.id);

    }

    const extra = Array.from(set)

      .filter((id) => !ordered.includes(id))

      .sort();

    return [...ordered, ...extra];

  }



  function setCategoryIdInternal(
    newId: string,
    opts?: { skipConfirm?: boolean },
  ) {
    if (
      !opts?.skipConfirm &&
      values.categoriaId &&
      values.categoriaId !== newId
    ) {
      const ok = window.confirm(
        "Al cambiar la categoría, los campos específicos pueden variar. ¿Continuar?",
      );
      if (!ok) return;
    }

    const cat = categories.find((c) => c.id === newId);
    const keys = mapCategoryCamposToFormFields(cat?.campos_config).map(
      (f) => f.key,
    );

    setValues((current) => ({
      ...current,
      categoriaId: newId,
      categoria: cat?.nombre ?? "",
      categoryActiveFieldKeys: keys,
    }));

    setErrors((current) => ({
      ...current,
      categoriaId: undefined,
      dynamicFields: undefined,
    }));
  }

  function setCategoryId(newId: string) {
    if (isVariant) {
      setValues((current) => ({
        ...current,
        inheritanceOverrides: {
          ...current.inheritanceOverrides,
          fields: { ...current.inheritanceOverrides.fields, categoriaId: true },
        },
      }));
    }
    if (!newId) {
      setValues((current) => ({
        ...current,
        categoriaId: "",
        categoria: "",
        categoryActiveFieldKeys: [],
      }));
      setErrors((current) => ({
        ...current,
        categoriaId: undefined,
        dynamicFields: undefined,
      }));
      return;
    }
    setCategoryIdInternal(newId);
  }

  function updateCategoryDynamicField(
    key: string,
    value: ProductFormFieldValue,
  ) {
    setValues((current) => ({
      ...current,
      categoryDynamicFields: {
        ...current.categoryDynamicFields,
        [key]: value,
      },
      inheritanceOverrides: isVariant
        ? {
            ...current.inheritanceOverrides,
            categorySpecifications: {
              ...current.inheritanceOverrides.categorySpecifications,
              [key]: true,
            },
          }
        : current.inheritanceOverrides,
    }));

    setErrors((current) => {
      if (!current.dynamicFields?.[key]) return current;
      const dynamicFields = { ...current.dynamicFields };
      delete dynamicFields[key];
      return {
        ...current,
        dynamicFields:
          Object.keys(dynamicFields).length > 0 ? dynamicFields : undefined,
      };
    });
  }

  async function createCategoryAndSelect(nombre: string, descripcion: string) {
    const row = await createProductCategory({ nombre, descripcion });
    setCategories((prev) => {
      const next = [...prev, row];
      next.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
      return next;
    });
    setCategoryIdInternal(row.id, { skipConfirm: true });
  }

  async function uploadProductDocument(
    file: File,
    meta: {
      tipo: string;
      scope?: "shared" | "individual";
      fechaExpiracion?: string | null;
      descripcionExtra?: string | null;
    },
  ) {
    const pid = productIdResolved;
    if (!pid) throw new Error("Guarda el producto antes de subir documentos.");
    await uploadProductDocumentApi(pid, file, meta);
    const rows = await fetchProductDocuments(pid);
    setDocuments(rows);
  }

  async function deleteProductDocument(relId: string) {
    const pid = productIdResolved;
    if (!pid) return;
    if (!window.confirm("¿Eliminar este documento?")) return;
    await deleteProductDocumentApi(pid, relId);
    setDocuments((prev) => prev.filter((d) => d.relId !== relId));
  }

  function updateField<K extends keyof ProductFormValues>(

    field: K,

    value: ProductFormValues[K],

  ) {

    setValues((current) => ({

      ...current,

      [field]: value,

      inheritanceOverrides:
        isVariant && PRODUCT_INHERITABLE_FIELDS.includes(field as ProductInheritableField)
          ? {
              ...current.inheritanceOverrides,
              fields: { ...current.inheritanceOverrides.fields, [field]: true },
            }
          : current.inheritanceOverrides,

    }));



    setErrors((current) => ({

      ...current,

      [field]: undefined,

    }));

  }

  function personalizeInheritedField(field: ProductInheritableField) {
    setValues((current) => ({
      ...current,
      inheritanceOverrides: {
        ...current.inheritanceOverrides,
        fields: { ...current.inheritanceOverrides.fields, [field]: true },
      },
    }));
  }

  function inheritFieldFromParent(field: ProductInheritableField) {
    setValues((current) => ({
      ...current,
      [field]: parentValues?.[field] ?? EMPTY_PRODUCT_FORM[field],
      inheritanceOverrides: {
        ...current.inheritanceOverrides,
        fields: { ...current.inheritanceOverrides.fields, [field]: false },
      },
    }));
  }

  function personalizeCategorySpecification(key: string) {
    setValues((current) => ({
      ...current,
      inheritanceOverrides: {
        ...current.inheritanceOverrides,
        categorySpecifications: {
          ...current.inheritanceOverrides.categorySpecifications,
          [key]: true,
        },
      },
    }));
  }

  function inheritCategorySpecificationFromParent(key: string) {
    setValues((current) => ({
      ...current,
      categoryDynamicFields: {
        ...current.categoryDynamicFields,
        [key]: parentValues?.categoryDynamicFields[key] ?? null,
      },
      inheritanceOverrides: {
        ...current.inheritanceOverrides,
        categorySpecifications: {
          ...current.inheritanceOverrides.categorySpecifications,
          [key]: false,
        },
      },
    }));
  }



  const handleImageUpload = useCallback(async (file: File) => {

    setUploadingImage(true);

    setGlobalError(null);

    try {

      const publicUrl = await uploadProductFormImage(file, values.sku);

      setValues((prev) => ({ ...prev, imagenUrl: publicUrl }));

    } catch (error) {

      const message =

        error instanceof Error ? error.message : "Error al subir la imagen";

      setGlobalError(message);

    } finally {

      setUploadingImage(false);

    }

  }, [values.sku]);



  function toggleAmazonMarketplace(marketplaceId: string, enabled: boolean) {

    setValues((current) => {

      const set = new Set(current.amazonSetup.assignedMarketplaceIds);

      if (enabled) set.add(marketplaceId);

      else set.delete(marketplaceId);



      const catalogEntry = amazonCatalog.find((c) => c.id === marketplaceId);

      const assignedMarketplaceIds = orderedAssignedIds(set);

      const contentByMarketplaceId = {

        ...current.amazonSetup.contentByMarketplaceId,

      };



      if (enabled && !contentByMarketplaceId[marketplaceId]) {

        const lang = catalogEntry?.languageCode?.trim() ?? "";

        const draft = createDefaultAmazonMarketplaceDraft(lang);

        if (catalogEntry?.code) draft.marketplaceCode = catalogEntry.code;

        contentByMarketplaceId[marketplaceId] = draft;

      }



      return {

        ...current,

        amazonSetup: { assignedMarketplaceIds, contentByMarketplaceId },

      };

    });

  }



  function updateAmazonMarketplaceDraft(

    marketplaceId: string,

    patch: Partial<AmazonMarketplaceContentDraft>,

  ) {

    setValues((current) => {

      const entry = amazonCatalog.find((c) => c.id === marketplaceId);

      const lang = entry?.languageCode?.trim() ?? "";

      const prev =

        current.amazonSetup.contentByMarketplaceId[marketplaceId] ??

        createDefaultAmazonMarketplaceDraft(lang);

      const withCode = {

        ...prev,

        marketplaceCode:

          prev.marketplaceCode ?? (entry?.code ? entry.code : undefined),

      };

      return {

        ...current,

        amazonSetup: {

          ...current.amazonSetup,

          contentByMarketplaceId: {

            ...current.amazonSetup.contentByMarketplaceId,

            [marketplaceId]: { ...withCode, ...patch },

          },

        },

      };

    });

  }



  async function submit() {

    const validationErrors = validateProductForm(values, {
      categoryFields: categoryFormFields,
    });



    setErrors(validationErrors);



    if (hasProductFormErrors(validationErrors)) {

      return;

    }



    try {

      setSaving(true);

      setGlobalError(null);
      setGlobalWarning(null);



      const result =

        isEditMode && productId

          ? await updateProductRequest(productId, values)

          : await createProductRequest(values);



      if (!result.ok) {

        if (result.errors) {

          setErrors(result.errors);

        }



        throw new Error(result.error ?? "No se pudo guardar el producto");

      }

      const warnings = Array.isArray(result.warnings)
        ? result.warnings.filter((w: unknown): w is string => typeof w === "string")
        : [];
      if (warnings.length > 0) {
        setGlobalWarning(warnings.join(" "));
        router.refresh();
        return;
      }



      const newId =
        !isEditMode && result.product?.id
          ? String(result.product.id)
          : null;

      if (newId) {
        if (values.parentId.trim()) {
          router.push(`/productos/${newId}`);
        } else {
          router.push(`/productos/${newId}/edit?created=1`);
        }
      } else {
        router.push("/productos");
      }

      router.refresh();

    } catch (error) {

      const message =

        error instanceof Error

          ? error.message

          : "Error guardando producto";



      setGlobalError(message);

    } finally {

      setSaving(false);

    }

  }



  function cancel() {

    router.push("/productos");

  }



  return {

    title,

    values,

    errors,

    loading,

    saving,

    uploadingImage,

    globalError,
    globalWarning,

    isEditMode,

    productId: productIdResolved,

    isVariant,
    variantCount,

    parentSummary,
    parentValues,

    selectedSupplierLogistics,

    documents,

    loadingDocuments,

    documentsError,

    uploadProductDocument,

    deleteProductDocument,

    amazonCatalog,

    catalogLoading,

    suppliers,

    loadingSuppliers,

    categories,

    loadingCategories,

    selectedCategory,

    categoryFormFields,

    pendingCategoryFields,

    showNewCategoryModal,

    setShowNewCategoryModal,

    setCategoryId,

    updateCategoryDynamicField,

    createCategoryAndSelect,

    updateField,
    personalizeInheritedField,
    inheritFieldFromParent,
    personalizeCategorySpecification,
    inheritCategorySpecificationFromParent,

    handleImageUpload,

    toggleAmazonMarketplace,

    updateAmazonMarketplaceDraft,

    submit,

    cancel,

  };

}

