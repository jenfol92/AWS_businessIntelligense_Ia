/** Tipos de documento para productos (`producto_documentos_rel.tipo` — enum Postgres). */
export const PRODUCT_DOCUMENT_TYPES = [
  { value: "ficha_tecnica", label: "Ficha técnica" },
  { value: "ce_certificate", label: "Certificado CE" },
  { value: "declaracion_conformidad", label: "Declaración de conformidad" },
  { value: "manual_instrucciones", label: "Manual" },
  { value: "fotografias", label: "Imágenes proveedor" },
  { value: "package", label: "Packing list" },
  { value: "test_report", label: "Informe de pruebas" },
  { value: "otros", label: "Otros" },
] as const;

export type ProductDocumentType = (typeof PRODUCT_DOCUMENT_TYPES)[number]["value"];

const LABEL_BY_VALUE = new Map(
  PRODUCT_DOCUMENT_TYPES.map((t) => [t.value, t.label]),
);

/** Etiqueta legible del tipo de documento. */
export function productDocumentTypeLabel(value: string | null | undefined): string {
  if (!value) return "Otros";
  return LABEL_BY_VALUE.get(value as ProductDocumentType) ?? value;
}
