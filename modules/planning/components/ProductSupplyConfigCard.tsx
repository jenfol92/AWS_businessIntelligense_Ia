// modules/planning/components/ProductSupplyConfigCard.tsx

/**

 * Contenedor visual (tarjeta) para la configuración logística de un producto.

 *

 * - Encapsula el aspecto “módulo ERP”: borde suave, sombra ligera y padding consistente.

 * - Delega toda la lógica de datos y validación en `ProductSupplyConfigForm`.

 *

 * Uso típico en una página de detalle de producto:

 *

 * ```tsx

 * <ProductSupplyConfigCard productId={product.id} />

 * ```

 */



"use client";



import { Card } from "@tremor/react";

import {

  ProductSupplyConfigForm,

  type ProductSupplyConfigFormProps,

} from "./ProductSupplyConfigForm";



export type ProductSupplyConfigCardProps = Pick<

  ProductSupplyConfigFormProps,

  "productId" | "heading"

> & {

  /** Clases extra en la tarjeta (por ejemplo ancho máximo en el grid de la página). */

  className?: string;

};



export function ProductSupplyConfigCard({

  productId,

  heading,

  className = "",

}: ProductSupplyConfigCardProps) {

  return (

    <Card

      className={`border border-slate-200/80 bg-white shadow-sm ring-1 ring-slate-100/90 dark:border-dark-tremor-border dark:bg-dark-tremor-background-muted dark:ring-dark-tremor-border ${className}`}

    >

      <div className="p-1 sm:p-2">

        <ProductSupplyConfigForm productId={productId} heading={heading} />

      </div>

    </Card>

  );

}


