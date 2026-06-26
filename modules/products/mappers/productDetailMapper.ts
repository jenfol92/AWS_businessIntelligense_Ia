// modules/products/mappers/productDetailMapper.ts

import type {
  ProductDetailDocumentoRel,
  ProductDetailMapperInput,
  ProductDetailResponse,
  ProductDetailSibling,
  ProductDetailVariante,
} from "../types/product-detail.types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStr(value: unknown): string {
  return value != null ? String(value) : "";
}

function pickDetalleEmbed(row: Record<string, unknown>): Record<string, unknown> | null {
  const raw = row.producto_detalle;

  if (raw == null) return null;

  if (Array.isArray(raw)) {
    const first = raw[0];
    return asRecord(first);
  }

  return asRecord(raw);
}

function mapSiblingRow(row: unknown): ProductDetailSibling | null {
  const r = asRecord(row);
  if (!r) return null;

  const det = pickDetalleEmbed(r);

  const imagen =
    det?.imagen_url != null
      ? String(det.imagen_url)
      : det?.imagenUrl != null
        ? String(det.imagenUrl)
        : null;

  return {
    id: toStr(r.id),
    sku: toStr(r.sku),
    nombre: toStr(r.nombre),
    estado: r.estado != null ? String(r.estado) : null,
    imagenUrl: imagen,
    color: det?.color != null ? String(det.color) : null,
  };
}

function mapVarianteRow(
  row: unknown,
  productId: string
): ProductDetailVariante | null {
  const r = asRecord(row);
  if (!r) return null;

  const id = toStr(r.id);
  if (!id || id === productId) return null;

  const det = pickDetalleEmbed(r);

  return {
    id,
    sku: toStr(r.sku),
    nombre: toStr(r.nombre),
    estado: r.estado != null ? String(r.estado) : null,
    heredarPrecio: Boolean(r.heredar_precio),
    imagenUrl: det?.imagen_url != null ? String(det.imagen_url) : null,
    color: det?.color != null ? String(det.color) : null,
  };
}

function mapDocumentRow(raw: unknown): ProductDetailDocumentoRel | null {
  const d = asRecord(raw);
  if (!d) return null;

  const id = toStr(d.id);
  if (!id) return null;

  const docPlural = asRecord(d.documentos);

  const file = docPlural
    ? {
        id: toStr(docPlural.id),
        nombre_archivo: toStr(docPlural.nombre_archivo),
        drive_id:
          docPlural.drive_id != null && docPlural.drive_id !== ""
            ? String(docPlural.drive_id)
            : null,
        fecha_expiracion:
          docPlural.fecha_expiracion != null
            ? String(docPlural.fecha_expiracion)
            : null,
        created_at:
          docPlural.created_at != null ? String(docPlural.created_at) : null,
      }
    : null;

  return {
    id,
    producto_id: toStr(d.producto_id),
    documento_id: toStr(d.documento_id),
    tipo: toStr(d.tipo),
    descripcion_extra:
      d.descripcion_extra != null ? String(d.descripcion_extra) : null,
    es_obligatorio_bi: Boolean(d.es_obligatorio_bi),
    esta_verificado: Boolean(d.esta_verificado),
    mercado: d.mercado != null ? String(d.mercado) : null,
    fecha_expiracion:
      d.fecha_expiracion != null ? String(d.fecha_expiracion) : null,
    documentos: file,
    documento: file
      ? {
          id: file.id || undefined,
          nombre_archivo: file.nombre_archivo,
          drive_id: file.drive_id,
          fecha_expiracion: file.fecha_expiracion ?? undefined,
        }
      : null,
  };
}

function mapSalesSummary(salesRows: unknown[], windowDays: number) {
  const rows = Array.isArray(salesRows) ? salesRows : [];

  const unidadesTotal = rows.reduce<number>((sum, row) => {
    const r = asRecord(row);
    return sum + toNumber(r?.unidades_vendidas);
  }, 0);
  
  const beneficioNetoTotal = rows.reduce<number>((sum, row) => {
    const r = asRecord(row);
    return sum + toNumber(r?.beneficio_operativo_neto);
  }, 0);
  
  const ingresosBrutosTotal = rows.reduce<number>((sum, row) => {
    const r = asRecord(row);
    return sum + toNumber(r?.ingresos_brutos);
  }, 0);
  
  const gastoAdsTotal = rows.reduce<number>((sum, row) => {
    const r = asRecord(row);
    return sum + toNumber(r?.publicidad_gasto_ads);
  }, 0);



  return {
    unidades_total: unidadesTotal,
    beneficio_neto_total: beneficioNetoTotal,
    ingresos_brutos_total: ingresosBrutosTotal,
    publicidad_gasto_ads_total: gastoAdsTotal,
    media_diaria_unidades: windowDays > 0 ? unidadesTotal / windowDays : 0,
    acos: ingresosBrutosTotal > 0 ? gastoAdsTotal / ingresosBrutosTotal : null,
    series: rows.map((row) => {
      const r = asRecord(row);

      return {
        fecha: toStr(r?.fecha),
        unidades: toNumber(r?.unidades_vendidas),
        beneficio_neto: toNumber(r?.beneficio_operativo_neto),
        ingresos_brutos: toNumber(r?.ingresos_brutos),
        publicidad_gasto_ads: toNumber(r?.publicidad_gasto_ads),
      };
    }),
  };
}

function mapInventory(inventario: unknown[], stockSugerido: unknown) {
  const rows = Array.isArray(inventario) ? inventario : [];
  const ss = asRecord(stockSugerido);

  const stockFba = rows.reduce<number>((sum, row) => {
    const r = asRecord(row);
    return sum + toNumber(r?.stock_fba);
  }, 0);
  
  const stockFbm = rows.reduce<number>((sum, row) => {
    const r = asRecord(row);
    return sum + toNumber(r?.stock_fbm);
  }, 0);
  
  const stockTotal = stockFba + stockFbm;

  return {
    by_country: rows,
    stock_fba: stockFba,
    stock_fbm: stockFbm,
    stock_total: stockTotal,
    stock_scope: toNumber(ss?.stock_actual) || stockTotal,
    riesgo: ss?.riesgo != null ? String(ss.riesgo) : null,
    dias_cobertura: toNullableNumber(ss?.dias_cobertura),
    stock_seguridad_minimo: toNumber(ss?.stock_seguridad_minimo),
    unidades_a_pedir: toNumber(ss?.unidades_a_pedir),
  };
}

function mapLogisticsSummary(proveedor: unknown, stockSugerido: unknown) {
  const p = asRecord(proveedor);
  const ss = asRecord(stockSugerido);

  const diasProduccion = toNumber(p?.dias_produccion_estandar);
  const diasTransito = toNumber(p?.dias_transito_estandar);

  const leadTimeProveedor: number = diasProduccion + diasTransito;
  const leadTimeVista = toNumber(ss?.lead_time_days);

  return {
    lead_time_dias: leadTimeVista > 0 ? leadTimeVista : leadTimeProveedor,
    buffer_dias: toNumber(ss?.buffer_days),
    pedido_recomendado: toNumber(ss?.unidades_a_pedir),
  };
}


function mapProfitability(rentabilidadActual: unknown, rentabilidadPais: unknown) {
  const source = asRecord(rentabilidadPais) ?? asRecord(rentabilidadActual);

  if (!source) {
    return {
      precio_venta_objetivo: null,
      coste_unitario: null,
      margen_bruto_porcentaje: null,
      raw: null,
    };
  }

  return {
    precio_venta_objetivo: toNullableNumber(
      source.precio_bruto ?? source.precio_venta_objetivo
    ),
    coste_unitario: toNullableNumber(
      source.coste_unitario ?? source.costo_total_estimado
    ),
    margen_bruto_porcentaje: toNullableNumber(
      source.margen_porcentaje ?? source.margen_estimado
    ),
    raw: source,
  };
}

export function mapProductDetailResponse(
  input: ProductDetailMapperInput
): ProductDetailResponse {
  const ventas = mapSalesSummary(input.salesRows, input.windowDays);
  const inventario = mapInventory(input.inventario, input.stockSugerido);
  const logisticaResumen = mapLogisticsSummary(
    input.proveedor,
    input.stockSugerido
  );
  const rentabilidad = mapProfitability(
    input.rentabilidadActual,
    input.rentabilidadPais
  );

  const siblings = input.siblings
    .map(mapSiblingRow)
    .filter((row): row is ProductDetailSibling => row !== null);

  const variantes = input.variantes
    .map((row) => mapVarianteRow(row, input.productId))
    .filter((row): row is ProductDetailVariante => row !== null);

  const documentos = input.documentos
    .map(mapDocumentRow)
    .filter((row): row is ProductDetailDocumentoRel => row !== null);

  return {
    ok: true,
    windowDays: input.windowDays,
    pais: input.pais,
    canal: input.canal,

    producto: input.producto,
    parent: input.parent,
    siblings,
    variantes,

    detalle: input.detalle,
    logistica: input.logistica,

    fichaTecnica: input.fichaTecnica,
    ficha: input.fichaTecnica,

    finanzas: input.finanzas,
    proveedor: input.proveedor,

    costos: input.costos,
    costeActual: input.costeActual,
    costeMedio: input.costeMedio,

    documentos,

    inventario,
    ventas,

    logisticaResumen,
    logistica_resumen: logisticaResumen,

    rentabilidad,

    precioEfectivo: input.precioEfectivo,
    costeBaseEfectivo: input.costeBaseEfectivo,
    costeUnitarioTotal: input.costeUnitarioTotal,

    stockSugerido: input.stockSugerido,
  };
}
