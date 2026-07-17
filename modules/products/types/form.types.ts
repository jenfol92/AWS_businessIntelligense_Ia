// modules/products/types/form.types.ts
//
// Reexporta el contrato unificado del formulario.

export type {
  AmazonListingStatus,
  ProductFormMode,
  ProductFormTab,
  ProductFormValues,
  ProductFormErrors,
  ProductFormDocumentRow,
  ProductCostCurrency,
  ProductFactoryCostByCurrency,
  ProductFormFieldType,
  ProductFormFieldValue,
  ProductFormFieldValidation,
  ProductFormFieldConfig,
  ProductSupplierOption,
  ProductSupplierLogisticsInfo,
  ProductCategoryOption,
} from "./product-form.types";

export type {
  AmazonMarketplaceCatalog,
  AmazonLanguageCode,
  ProductMarketplace,
  ProductAmazonContent,
  AmazonContentValidationWarning,
  AmazonContentQualityScore,
  AmazonMarketplaceContentDraft,
  ProductAmazonSetupFormValues,
  ProductAmazonSetupLoadResult,
} from "./product-amazon.types";
