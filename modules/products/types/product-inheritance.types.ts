export const PRODUCT_INHERITABLE_FIELDS = [
  "referenciaFabricante",
  "categoriaId",
  "unidadesPorCaja",
  "pedidoMinimoUnidades",
  "materialEstructura",
  "materialTapizado",
  "materialRuedas",
  "pesoNetoKg",
  "pesoBrutoKg",
  "altoCajaCm",
  "anchoCajaCm",
  "largoCajaCm",
  "altoAbiertoCm",
  "anchoAbiertoCm",
  "fondoAbiertoCm",
  "altoPlegadoCm",
  "anchoPlegadoCm",
  "fondoPlegadoCm",
] as const;

export type ProductInheritableField = (typeof PRODUCT_INHERITABLE_FIELDS)[number];

export type ProductInheritanceOverrides = {
  fields: Partial<Record<ProductInheritableField, boolean>>;
  categorySpecifications: Record<string, boolean>;
};

export const EMPTY_PRODUCT_INHERITANCE_OVERRIDES: ProductInheritanceOverrides = {
  fields: {},
  categorySpecifications: {},
};
