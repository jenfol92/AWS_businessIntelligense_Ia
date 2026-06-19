// modules/products/services/productClient.ts

import type { ProductFormValues } from "../types";

// Este archivo se usa desde el cliente.
// Solo hace llamadas fetch a nuestras API routes.

export async function fetchProductById(productId: string) {
  const response = await fetch(`/api/products/${productId}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("No se pudo cargar el producto");
  }

  return response.json();
}

export async function createProductRequest(values: ProductFormValues) {
  const response = await fetch("/api/products", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(values),
  });

  const data = await response.json();

  if (!response.ok) {
    return data;
  }

  return data;
}

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

  const data = await response.json();

  if (!response.ok) {
    return data;
  }

  return data;
}

export async function deleteProductRequest(productId: string) {
  const response = await fetch(`/api/products/${productId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("No se pudo eliminar el producto");
  }

  return response.json();
}