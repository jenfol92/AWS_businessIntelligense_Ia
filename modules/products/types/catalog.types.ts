// modules/products/types/catalog.types.ts

export type ProductCatalogQuery = {
  q?: string;
  limit: number;
  offset: number;
  agenteIds: string[];
  puertos: string[];
  categorias: string[];
  estados: string[];
  /** Si true, no aplica ilike SQL; el service filtra con búsqueda normalizada. */
  useNormalizedSearch?: boolean;
};
  
  export type ProductCatalogRawRow = {
    producto_id: string;
    sku: string | null;
    nombre: string | null;
    asin: string | null;
    estado: string | null;
    proveedor_id: string | null;
    stock_seguridad_minimo: number | null;
    parent_id: string | null;
    heredar_precio: boolean | null;
    last_ordered_at: string | null;
    updated_at: string | null;
  
    imagen_url: string | null;
    marca: string | null;
    color: string | null;
    categoria: string | null;
  
    proveedor_nombre: string | null;
    proveedor_pais: string | null;
    puerto_preferido: string | null;

    agente_id: string | null;
    agente_empresa: string | null;
    agente_contacto: string | null;
  
    stock_fba: number | null;
    stock_fbm: number | null;
    stock_total: number | null;
  
    precio_venta_objetivo: number | null;
    costo_total_estimado: number | null;
    margen_estimado: number | null;
  
    dias_cobertura: number | null;
    unidades_a_pedir: number | null;
    riesgo: string | null;
    avg_daily_used: number | null;
  
    publicidad_gasto_ads_30d: number | null;
    ventas_atribuidas_ads_30d: number | null;
    acos_30d: number | null;

    /** UUID en producto_detalle; columna final de v_productos_catalogo. */
    categoria_id: string | null;
  };
  
  export type ProductCatalogItem = {
    id: string;
    sku: string;
    nombre: string;
    asin: string | null;
    estado: string;
  
    imagenUrl: string | null;
    categoria: string;
    categoriaId: string | null;
    marca: string | null;
    color: string | null;
  
    proveedorId: string | null;
    proveedorNombre: string;
    proveedorPais: string | null;
    /** Puerto preferido (fila catálogo / snapshot proveedor). */
    puertoPreferido: string | null;

    agenteId: string | null;
    agenteEmpresa: string | null;
    agenteContacto: string | null;
  
    stockFba: number;
    stockFbm: number;
    stockTotal: number;
    stockSeguridadMinimo: number;
  
    precioVentaObjetivo: number | null;
    costeTotalEstimado: number | null;
    margenEstimado: number | null;
    acos30d: number | null;
  
    diasCobertura: number | null;
    unidadesAPedir: number | null;
    riesgo: string | null;
    ventasDiariasPromedio: number | null;
  
    parentId: string | null;
    heredarPrecio: boolean;
    lastOrderedAt: string | null;
    updatedAt: string | null;
  };
  
  export type ProductCatalogResponse = {
    ok: true;
    options: ProductCatalogFilterOptions;
    rows: ProductCatalogItem[];
    pagination: {
      limit: number;
      offset: number;
      hasMore: boolean;
    };
  };

  export type ProductCatalogFilterOptions = {
    agentes: {
      id: string;
      empresa: string;
      contacto: string | null;
    }[];
    puertos: string[];
    categorias: {
      id: string;
      nombre: string;
    }[];
    estados: {
      value: string;
      label: string;
    }[];
  };
  
  export type ProductCatalogOptionsResponse = {
    ok: true;
    options: ProductCatalogFilterOptions;
  };