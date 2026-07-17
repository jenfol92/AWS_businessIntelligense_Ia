export function shouldShowCostPropagationCheckbox(params: {
  isEditMode: boolean;
  isVariant: boolean;
  variantCount: number;
}): boolean {
  return params.isEditMode && !params.isVariant && params.variantCount > 0;
}
