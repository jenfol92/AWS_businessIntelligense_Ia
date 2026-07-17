import assert from "node:assert/strict";
import { shouldShowCostPropagationCheckbox } from "./productCostFormVisibility";

assert.equal(
  shouldShowCostPropagationCheckbox({
    isEditMode: true,
    isVariant: false,
    variantCount: 0,
  }),
  false,
  "padre sin variantes oculta checkbox de propagacion",
);

assert.equal(
  shouldShowCostPropagationCheckbox({
    isEditMode: true,
    isVariant: false,
    variantCount: 2,
  }),
  true,
  "padre con variantes muestra checkbox de propagacion",
);

assert.equal(
  shouldShowCostPropagationCheckbox({
    isEditMode: true,
    isVariant: true,
    variantCount: 2,
  }),
  false,
  "variante oculta checkbox de propagacion",
);
