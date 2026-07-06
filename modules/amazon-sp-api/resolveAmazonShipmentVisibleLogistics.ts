export type VisibleLogisticsSource =
  | "amazon"
  | "contenedor_erp"
  | "no_aplica"
  | "no_disponible";

export type VisibleLogisticsField = {
  value: string | null;
  source: VisibleLogisticsSource;
  label: string;
};

export type AmazonShipmentVisibleLogistics = {
  eta: VisibleLogisticsField;
  etd: VisibleLogisticsField;
  tracking: VisibleLogisticsField;
  carrier: VisibleLogisticsField;
  containerNumber: VisibleLogisticsField;
  containerApplicability: "aplica" | "no_aplica" | "desconocido";
};

export type AmazonShipmentVisibleHeaderInput = {
  eta_estimada?: string | null;
  fecha_salida?: string | null;
  tracking_number?: string | null;
  agl_tracking_number?: string | null;
  carrier?: string | null;
  amazon_container_number?: string | null;
  booking_reference?: string | null;
  v2024_enrichment?: unknown;
};

export type AmazonShipmentVisibleContainerInput = {
  identificador_embarque?: string | null;
  fecha_eta_estimada?: string | null;
  fecha_salida?: string | null;
} | null;

const UNAVAILABLE_LABEL = "Dato no disponible en la fuente actual";

function field(
  value: string | null | undefined,
  source: VisibleLogisticsSource,
  label?: string,
): VisibleLogisticsField {
  const clean = String(value ?? "").trim() || null;
  return {
    value: clean,
    source,
    label: clean ? (label ?? clean) : (label ?? UNAVAILABLE_LABEL),
  };
}

export function resolveAmazonShipmentVisibleLogistics(params: {
  header: AmazonShipmentVisibleHeaderInput | null;
  logisticsFlow: string | null;
  container: AmazonShipmentVisibleContainerInput;
}): AmazonShipmentVisibleLogistics {
  const header = params.header;
  const flow = params.logisticsFlow;
  const isFactoryToAmazon =
    flow === "fabrica_a_amazon" || flow === "proveedor_a_amazon";
  const container = params.container;
  const hasContainer = Boolean(container);
  const containerApplies =
    flow === "almacen_a_amazon"
      ? "no_aplica"
      : isFactoryToAmazon
        ? "aplica"
        : "desconocido";

  const eta =
    header?.eta_estimada
      ? field(header.eta_estimada, "amazon")
      : isFactoryToAmazon && container?.fecha_eta_estimada
        ? field(container.fecha_eta_estimada, "contenedor_erp")
        : field(null, "no_disponible");

  const etd =
    header?.fecha_salida
      ? field(header.fecha_salida, "amazon")
      : isFactoryToAmazon && container?.fecha_salida
        ? field(container.fecha_salida, "contenedor_erp")
        : field(null, "no_disponible");

  let containerNumber: VisibleLogisticsField;
  if (flow === "almacen_a_amazon") {
    containerNumber = field(null, "no_aplica", "No aplica");
  } else if (isFactoryToAmazon && hasContainer) {
    containerNumber = field(container?.identificador_embarque, "contenedor_erp");
  } else if (header?.amazon_container_number || header?.booking_reference) {
    containerNumber = field(
      header.amazon_container_number ?? header.booking_reference,
      "amazon",
    );
  } else {
    containerNumber = field(null, "no_disponible");
  }

  return {
    eta,
    etd,
    tracking: header?.tracking_number
      ? field(header.tracking_number, "amazon")
      : header?.agl_tracking_number
        ? field(header.agl_tracking_number, "amazon")
        : field(null, "no_disponible"),
    carrier: header?.carrier ? field(header.carrier, "amazon") : field(null, "no_disponible"),
    containerNumber,
    containerApplicability: containerApplies,
  };
}
