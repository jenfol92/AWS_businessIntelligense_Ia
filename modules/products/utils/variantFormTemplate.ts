import { EMPTY_PRODUCT_FORM } from "../constants";
import type { ProductAmazonSetupFormValues } from "../types/product-amazon.types";
import type { ProductFormValues } from "../types/product-form.types";

function cloneAmazonSetupForVariant(
  setup: ProductAmazonSetupFormValues,
): ProductAmazonSetupFormValues {
  const contentByMarketplaceId: ProductAmazonSetupFormValues["contentByMarketplaceId"] =
    {};

  for (const [marketplaceId, draft] of Object.entries(
    setup.contentByMarketplaceId,
  )) {
    if (!draft) continue;
    contentByMarketplaceId[marketplaceId] = {
      ...draft,
      listingAsin: "",
      listingSku: "",
    };
  }

  return {
    assignedMarketplaceIds: [...setup.assignedMarketplaceIds],
    contentByMarketplaceId,
  };
}

/** Plantilla de formulario para nueva variante: hereda datos del padre, no identidad propia. */
export function buildVariantFormFromParent(
  parent: ProductFormValues,
  parentId: string,
): ProductFormValues {
  return {
    ...EMPTY_PRODUCT_FORM,
    parentId,
    heredarPrecio: true,

    proveedorId: parent.proveedorId,
    stockSeguridadMinimo: parent.stockSeguridadMinimo,

    categoriaId: parent.categoriaId,
    categoria: parent.categoria,
    categoryDynamicFields: { ...parent.categoryDynamicFields },
    categoryActiveFieldKeys: [...parent.categoryActiveFieldKeys],

    marca: parent.marca,
    modelo: parent.modelo,
    descripcionTecnica: parent.descripcionTecnica,

    unidadesPorCaja: parent.unidadesPorCaja,
    pedidoMinimoUnidades: parent.pedidoMinimoUnidades,

    precioVentaBase: parent.precioVentaBase,
    priceChannel: parent.priceChannel,

    arancelPorcentaje: parent.arancelPorcentaje,

    notasGenerales: parent.notasGenerales,

    pesoNetoKg: parent.pesoNetoKg,
    pesoBrutoKg: parent.pesoBrutoKg,
    altoCajaCm: parent.altoCajaCm,
    anchoCajaCm: parent.anchoCajaCm,
    largoCajaCm: parent.largoCajaCm,
    altoAbiertoCm: parent.altoAbiertoCm,
    anchoAbiertoCm: parent.anchoAbiertoCm,
    fondoAbiertoCm: parent.fondoAbiertoCm,
    altoPlegadoCm: parent.altoPlegadoCm,
    anchoPlegadoCm: parent.anchoPlegadoCm,
    fondoPlegadoCm: parent.fondoPlegadoCm,
    materialEstructura: parent.materialEstructura,
    materialTapizado: parent.materialTapizado,
    materialRuedas: parent.materialRuedas,
    edadMinimaAplicable: parent.edadMinimaAplicable,
    edadMaximaAplicable: parent.edadMaximaAplicable,

    amazonTitle: parent.amazonTitle,
    amazonBrand: parent.amazonBrand,
    amazonDescription: parent.amazonDescription,
    amazonBullet1: parent.amazonBullet1,
    amazonBullet2: parent.amazonBullet2,
    amazonBullet3: parent.amazonBullet3,
    amazonBullet4: parent.amazonBullet4,
    amazonBullet5: parent.amazonBullet5,
    amazonKeywords: parent.amazonKeywords,
    amazonTargetAudience: parent.amazonTargetAudience,
    amazonSearchTerms: parent.amazonSearchTerms,
    amazonProductType: parent.amazonProductType,
    amazonBrowseNodeId: parent.amazonBrowseNodeId,
    amazonConditionType: parent.amazonConditionType,
    amazonLanguage: parent.amazonLanguage,
    amazonMarketplace: parent.amazonMarketplace,
    amazonSyncEnabled: parent.amazonSyncEnabled,
    amazonListingStatus: parent.amazonListingStatus,
    amazonLastSyncAt: parent.amazonLastSyncAt,

    amazonSetup: cloneAmazonSetupForVariant(parent.amazonSetup),
  };
}
