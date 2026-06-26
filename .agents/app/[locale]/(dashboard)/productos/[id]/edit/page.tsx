// app/[locale]/(dashboard)/productos/[id]/edit/page.tsx

import { Suspense } from "react";
import { ProductFormPage } from "@/modules/products/components/form/ProductFormPage";

type PageProps = {
  params: {
    id: string;
  };
};

function FormFallback() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
      Cargando formulario…
    </div>
  );
}

export default function Page({ params }: PageProps) {
  return (
    <Suspense fallback={<FormFallback />}>
      <ProductFormPage mode="edit" productId={params.id} />
    </Suspense>
  );
}
