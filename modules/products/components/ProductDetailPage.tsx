// modules/products/components/ProductDetailPage.tsx

"use client";

import { Card, Text } from "@tremor/react";
import { useRouter } from "next/navigation";
import { useGlobalFilters } from "@/shared/filters/useGlobalFilters";
import { useProductDetail } from "../hooks/useProductDetail";
import type { ProductDetailResponse } from "../types/product-detail.types";

import { ProductDetailKpis } from "./ProductDetailKpis";
import { ProductInventoryCard } from "./ProductInventoryCard";
import { ProductSalesCard } from "./ProductSalesCard";
import { ProductLogisticsCard } from "./ProductLogisticsCard";
import { ProductDocumentsCard } from "./ProductDocumentsCard";
import { ProductDetailCostsCard } from "./ProductDetailCostsCard";
import { ProductSupplyConfigCard } from "@/modules/planning/components/ProductSupplyConfigCard";
import { ProductDetailHeroSection } from "./detail/ProductDetailHeroSection";

type ProductDetailPageProps = {
  productId: string;
};

/**
 * Ficha principal del producto.
 *
 * Responsabilidad:
 * - Recibir productId.
 * - Leer filtros globales.
 * - Pedir datos mediante useProductDetail.
 * - Organizar componentes visuales.
 *
 * No debe:
 * - Consultar Supabase directamente.
 * - Calcular márgenes, ACOS o stock.
 * - Mezclar datos de varias tablas.
 */
export function ProductDetailPage({ productId }: ProductDetailPageProps) {
  const router = useRouter();

  const { windowDays, pais, canal } = useGlobalFilters();

  const { data, loading, error, reload } = useProductDetail({
    productId,
    windowDays,
    pais,
    canal,
  });

  const scrollToLower = () => {
    document
      .getElementById("product-detail-lower")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollToDocuments = () => {
    document
      .getElementById("product-documents-section")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Card className="border border-slate-200/80 shadow-sm dark:border-dark-tremor-border">
          <Text>Cargando producto...</Text>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Card className="border border-rose-200 bg-rose-50/50 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/20">
          <Text className="text-rose-800 dark:text-rose-200">
            {error ?? "No se pudo cargar el producto"}
          </Text>
        </Card>
      </div>
    );
  }

  const detail: ProductDetailResponse = data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <ProductDetailHeroSection
        data={detail}
        productId={productId}
        onBack={() => router.back()}
        onEdit={() => router.push(`/productos/${productId}/edit`)}
        onManageDocuments={() =>
          router.push(`/productos/${productId}/edit?tab=documentacion`)
        }
        onReload={reload}
        onNavigateToParent={(id) => router.push(`/productos/${id}`)}
        onSelectVariant={(id) => router.push(`/productos/${id}`)}
        onScrollToLower={scrollToLower}
        onScrollToDocuments={scrollToDocuments}
      />

      <div
        id="product-detail-lower"
        className="mt-8 scroll-mt-6 space-y-6 border-t border-slate-100 pt-8"
      >
        <ProductDetailKpis
          inventario={detail.inventario}
          ventas={detail.ventas}
          rentabilidad={detail.rentabilidad}
          stockSugerido={detail.stockSugerido}
          logisticaResumen={detail.logisticaResumen}
        />

        <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
          <div className="space-y-6 lg:col-span-2">
            <ProductSalesCard
              ventas={detail.ventas}
              windowDays={detail.windowDays}
            />

            <ProductDetailCostsCard data={detail} />

            <div id="product-documents-section" className="scroll-mt-6">
              <ProductDocumentsCard
                productId={productId}
                documentos={detail.documentos ?? []}
              />
            </div>
          </div>

          <div className="space-y-6 lg:col-span-1">
            <ProductInventoryCard
              inventario={detail.inventario}
              stockSugerido={detail.stockSugerido}
            />

            <ProductLogisticsCard
              logistica={detail.logistica}
              fichaTecnica={detail.fichaTecnica}
              proveedor={detail.proveedor}
              logisticaResumen={detail.logistica_resumen}
            />

            <ProductSupplyConfigCard
              productId={productId}
              heading="Configuración logística"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
