"use client";

import { Card, Text, Title } from "@tremor/react";

type ProductSupplyConfigCardProps = {
  productId?: string;
};

export function ProductSupplyConfigCard({
  productId,
}: ProductSupplyConfigCardProps) {
  return (
    <Card className="border-slate-200">
      <Title>Configuración de aprovisionamiento</Title>
      <Text className="mt-2 text-sm text-slate-500">
        Esta sección está pendiente de migración.
      </Text>

      {productId && (
        <Text className="mt-2 text-xs text-slate-400">
          Producto: {productId}
        </Text>
      )}
    </Card>
  );
}