// app/[locale]/(dashboard)/productos/[id]/page.tsx

import { ProductDetailPage } from "@/modules/products/components/ProductDetailPage";

type PageProps = {
  params: {
    id: string;
  };
};

// Esta página no consulta datos ni contiene lógica visual.
// Solo entrega el ID al módulo de productos.
export default function Page({ params }: PageProps) {
  return <ProductDetailPage productId={params.id} />;
}