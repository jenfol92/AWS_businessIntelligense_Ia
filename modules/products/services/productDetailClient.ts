// modules/products/services/productDetailClient.ts

type FetchProductDetailParams = {
    productId: string;
    windowDays: number;
    pais: string;
    canal: string;
  };
  
  // Este archivo se usa desde React.
  // Solo llama a la API.
  export async function fetchProductDetail({
    productId,
    windowDays,
    pais,
    canal,
  }: FetchProductDetailParams) {
    const params = new URLSearchParams();
  
    params.set("windowDays", String(windowDays));
  
    if (pais && pais !== "ALL") {
      params.set("pais", pais);
    }
  
    if (canal && canal !== "ALL") {
      params.set("canal", canal);
    }
  
    const response = await fetch(
      `/api/products/${encodeURIComponent(productId)}?${params.toString()}`,
      {
        cache: "no-store",
      }
    );
  
    const data = await response.json().catch(() => null);
  
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error ?? "No se pudo cargar el producto");
    }
  
    return data;
  }