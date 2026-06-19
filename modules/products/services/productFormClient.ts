// modules/products/services/productFormClient.ts

import type {
  AmazonMarketplaceCatalog,
  ProductCategoryOption,
  ProductFormValues,
  ProductSupplierOption,
} from "../types";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Proveedores para el desplegable del formulario. */
export async function fetchProductFormSuppliers(): Promise<
  ProductSupplierOption[]
> {
  const response = await fetch("/api/suppliers", { cache: "no-store" });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok || !Array.isArray(data.suppliers)) {
    throw new Error(data?.error ?? "No se pudieron cargar los proveedores");
  }

  const suppliers = (data.suppliers as Record<string, unknown>[]).map(
    (s) => ({
      id: String(s.id ?? ""),
      nombre: String(s.nombre ?? ""),
      pais: (s.pais as string | null) ?? null,
      diasProduccionEstandar:
        s.dias_produccion_estandar != null
          ? Number(s.dias_produccion_estandar)
          : null,
      diasTransitoEstandar:
        s.dias_transito_estandar != null
          ? Number(s.dias_transito_estandar)
          : null,
      puertoPreferidoNombre:
        (s.puerto_preferido_nombre as string | null) ??
        (s.puerto_preferido as string | null) ??
        null,
      agenteContacto: (s.agente_contacto as string | null) ?? null,
    }),
  ) satisfies ProductSupplierOption[];
  if (process.env.NODE_ENV === "development") {
    console.debug("[productFormClient] suppliers parsed:", suppliers.length);
  }
  return suppliers;
}

/** Categorías activas con campos_config para el formulario. */
export async function fetchProductFormCategories(): Promise<
  ProductCategoryOption[]
> {
  const response = await fetch("/api/categories", { cache: "no-store" });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok || !Array.isArray(data.rows)) {
    throw new Error(data?.error ?? "No se pudieron cargar las categorías");
  }

  return data.rows as ProductCategoryOption[];
}

/** Crea categoría mínima desde el formulario de producto. */
export async function createProductCategory(input: {
  nombre: string;
  descripcion?: string;
}): Promise<ProductCategoryOption> {
  const response = await fetch("/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre: input.nombre,
      descripcion: input.descripcion ?? null,
      campos_config: { campos: [] },
    }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok || !data.row) {
    throw new Error(data?.error ?? "No se pudo crear la categoría");
  }

  return data.row as ProductCategoryOption;
}

/**
 * Sube imagen a Storage (`product-images`) y devuelve la URL pública.
 */
export async function uploadProductFormImage(
  file: File,
  sku: string,
): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("La imagen supera 5 MB");
  }

  const fd = new FormData();
  fd.set("file", file);
  fd.set("sku", sku.trim());

  const response = await fetch("/api/storage/product-image", {
    method: "POST",
    body: fd,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok || typeof data.publicUrl !== "string") {
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : "Error al subir la imagen",
    );
  }

  return data.publicUrl;
}

/**
 * Catálogo `amazon_marketplaces` para el formulario de producto.
 */
export async function fetchAmazonMarketplacesCatalog(): Promise<
  AmazonMarketplaceCatalog[]
> {
  const response = await fetch("/api/products/amazon-marketplaces", {
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok || !Array.isArray(data.rows)) {
    throw new Error(data?.error ?? "No se pudo cargar el catálogo Amazon");
  }

  return data.rows as AmazonMarketplaceCatalog[];
}

/**
 * Carga los datos de un producto para el formulario de edición.
 */
export async function fetchProductFormById(productId: string) {
  const response = await fetch(`/api/products/${productId}/form`, {
    cache: "no-store",
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data) {
    throw new Error(data?.error ?? "No se pudo cargar el producto");
  }

  return data;
}

/**
 * Crea un producto nuevo.
 */
export async function createProductRequest(values: ProductFormValues) {
  const response = await fetch("/api/products", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(values),
  });

  const data = await response.json().catch(() => null);

  if (!data) {
    throw new Error("Respuesta inválida del servidor");
  }

  return data;
}

/**
 * Actualiza un producto existente.
 */
export async function updateProductRequest(
  productId: string,
  values: ProductFormValues
) {
  const response = await fetch(`/api/products/${productId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(values),
  });

  const data = await response.json().catch(() => null);

  if (!data) {
    throw new Error("Respuesta inválida del servidor");
  }

  return data;
}