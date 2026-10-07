import type { PublishedCatalogFbmStock } from "../repositories/productCatalogFbmRepository";

export function ProductCatalogFbmStock({ stock }: { stock?: PublishedCatalogFbmStock }) {
  if (stock?.status !== "PUBLISHED") {
    return <span title={stock?.status === "UNAVAILABLE" ? "No se pudo leer el stock FBM publicado." : "Sin snapshot FBM publicado para este producto."}>FBM —</span>;
  }
  const date = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit" }).format(new Date(stock.observedAt!));
  return <span title={`Stock FBM publicado, observado: ${stock.observedAt}`}>FBM {stock.quantity?.toLocaleString("es-ES")} · {date}</span>;
}
