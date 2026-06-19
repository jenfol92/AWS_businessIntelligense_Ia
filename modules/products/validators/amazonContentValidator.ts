// modules/products/validators/amazonContentValidator.ts
//
// Avisos de estilo/cumplimiento orientados a Seller Central (no bloquean guardado).

import type { ProductFormValues } from "../types/product-form.types";
import type {
  AmazonContentQualityScore,
  AmazonContentValidationWarning,
  AmazonMarketplaceContentDraft,
} from "../types/product-amazon.types";
import {
  AMAZON_CONTENT_LIMITS,
  AMAZON_EMAIL_PATTERN,
  AMAZON_PHONE_PATTERN,
  AMAZON_URL_PATTERN,
} from "../constants";

export type { AmazonContentValidationWarning };

const CLAIMS =
  /\b(el mejor|la mejor|los mejores|n[ºo°]\s*1|numero\s*1|número\s*1|#1|# 1|garantizado|100\s*%\s*segur|100%\s*seguro|gratis|oferta|descuento|compra\s*ya|compra\s*ahora|siempre\s*el\s*mejor)\b/i;

const WEIRD_SYMBOLS = /[⚠★☆♥♦►◄◇◆✓✔✘✖※♪♫]/;

const MAX_KEYWORDS = 250;

function pushUnique(
  out: AmazonContentValidationWarning[],
  code: string,
  message: string,
): void {
  if (!out.some((w) => w.code === code)) {
    out.push({ code, message });
  }
}

function containsEmoji(s: string): boolean {
  return Array.from(s).some((ch) => {
    const u = ch.codePointAt(0) ?? 0;
    return (
      (u >= 0x1f300 && u <= 0x1f9ff) ||
      (u >= 0x2600 && u <= 0x27bf) ||
      (u >= 0xfe00 && u <= 0xfe0f)
    );
  });
}

function hasExcessiveCaps(text: string, thresholdRatio = 0.55): boolean {
  const letters = text.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ]/g, "");
  if (letters.length < 12) return false;
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, "").length;
  return upper / letters.length >= thresholdRatio;
}

export type AmazonContentFieldsInput = Pick<
  ProductFormValues,
  | "amazonTitle"
  | "amazonDescription"
  | "amazonBullet1"
  | "amazonBullet2"
  | "amazonBullet3"
  | "amazonBullet4"
  | "amazonBullet5"
  | "amazonSearchTerms"
  | "amazonKeywords"
>;

export function validateAmazonTitle(title: string): AmazonContentValidationWarning[] {
  const w: AmazonContentValidationWarning[] = [];
  const max = AMAZON_CONTENT_LIMITS.titleMaxLength;
  const t = title.trim();
  if (!t) {
    pushUnique(w, "title_empty", "El título comercial está vacío.");
  }
  if (title.length > max) {
    pushUnique(
      w,
      "title_length",
      `El título supera ${max} caracteres (${title.length}).`,
    );
  }
  if (containsEmoji(title)) {
    pushUnique(w, "title_emoji", "Evita emojis en el título.");
  }
  if (hasExcessiveCaps(title)) {
    pushUnique(
      w,
      "title_caps",
      "Demasiadas mayúsculas en el título; Amazon suele penalizarlo.",
    );
  }
  if (AMAZON_URL_PATTERN.test(title)) {
    pushUnique(w, "title_url", "No incluyas URLs en el título.");
  }
  if (AMAZON_EMAIL_PATTERN.test(title)) {
    pushUnique(w, "title_email", "No incluyas correos en el título.");
  }
  if (AMAZON_PHONE_PATTERN.test(title)) {
    pushUnique(w, "title_phone", "No incluyas teléfonos en el título.");
  }
  if (CLAIMS.test(title)) {
    pushUnique(
      w,
      "title_claim",
      "Evita superlativos u ofertas en el título (mejor, nº1, gratis, etc.).",
    );
  }
  if (WEIRD_SYMBOLS.test(title)) {
    pushUnique(w, "title_symbols", "Revisa símbolos especiales en el título.");
  }
  return w;
}

export function validateAmazonDescription(
  description: string,
): AmazonContentValidationWarning[] {
  const w: AmazonContentValidationWarning[] = [];
  const max = AMAZON_CONTENT_LIMITS.descriptionMaxLength;
  if (!description.trim()) {
    pushUnique(w, "desc_empty", "La descripción está vacía.");
  }
  if (description.length > max) {
    pushUnique(
      w,
      "desc_length",
      `La descripción supera ${max} caracteres (${description.length}).`,
    );
  }
  if (containsEmoji(description)) {
    pushUnique(w, "desc_emoji", "Evita emojis en la descripción.");
  }
  if (AMAZON_URL_PATTERN.test(description)) {
    pushUnique(w, "desc_url", "Las URLs en descripción pueden restringirse.");
  }
  if (AMAZON_EMAIL_PATTERN.test(description)) {
    pushUnique(w, "desc_email", "No incluyas correos en la descripción.");
  }
  if (AMAZON_PHONE_PATTERN.test(description)) {
    pushUnique(w, "desc_phone", "Revisa posibles teléfonos en la descripción.");
  }
  if (CLAIMS.test(description)) {
    pushUnique(
      w,
      "desc_claim",
      "Revisa claims promocionales o absolutos en la descripción.",
    );
  }
  return w;
}

export function validateAmazonBullets(
  bullets: readonly string[],
): AmazonContentValidationWarning[] {
  const w: AmazonContentValidationWarning[] = [];
  const max = AMAZON_CONTENT_LIMITS.bulletMaxLength;
  bullets.forEach((b, i) => {
    const n = i + 1;
    if (b.length > max) {
      pushUnique(
        w,
        `bullet_${n}_length`,
        `Bullet ${n} supera ${max} caracteres (${b.length}).`,
      );
    }
    if (containsEmoji(b)) {
      pushUnique(w, `bullet_${n}_emoji`, `Bullet ${n}: evita emojis.`);
    }
    if (AMAZON_URL_PATTERN.test(b)) {
      pushUnique(w, `bullet_${n}_url`, `Bullet ${n}: sin URLs.`);
    }
    if (CLAIMS.test(b)) {
      pushUnique(
        w,
        `bullet_${n}_claim`,
        `Bullet ${n}: revisa lenguaje promocional.`,
      );
    }
  });
  const nonEmpty = bullets.filter((x) => x.trim().length > 0).length;
  if (
    nonEmpty > 0 &&
    nonEmpty < AMAZON_CONTENT_LIMITS.minimumBulletsRecommended
  ) {
    pushUnique(
      w,
      "bullets_count",
      `Amazon suele esperar al menos ${AMAZON_CONTENT_LIMITS.minimumBulletsRecommended} bullets con contenido.`,
    );
  }
  return w;
}

export function validateAmazonSearchTerms(
  terms: string,
): AmazonContentValidationWarning[] {
  const w: AmazonContentValidationWarning[] = [];
  const max = AMAZON_CONTENT_LIMITS.searchTermsMaxLength;
  if (terms.length > max) {
    pushUnique(
      w,
      "search_terms_length",
      `Search terms supera ${max} caracteres (${terms.length}).`,
    );
  }
  if (AMAZON_URL_PATTERN.test(terms)) {
    pushUnique(w, "search_terms_url", "No uses URLs en search terms.");
  }
  if (containsEmoji(terms)) {
    pushUnique(w, "search_terms_emoji", "Evita emojis en search terms.");
  }
  if (CLAIMS.test(terms)) {
    pushUnique(
      w,
      "search_terms_claim",
      "Evita lenguaje promocional en search terms.",
    );
  }
  return w;
}

export function validateAmazonKeywords(
  keywords: string,
): AmazonContentValidationWarning[] {
  const w: AmazonContentValidationWarning[] = [];
  if (keywords.length > MAX_KEYWORDS) {
    pushUnique(
      w,
      "keywords_length",
      `Keywords supera ${MAX_KEYWORDS} caracteres (${keywords.length}).`,
    );
  }
  return w;
}

export function validateAmazonContent(
  values: AmazonContentFieldsInput,
): AmazonContentValidationWarning[] {
  const out: AmazonContentValidationWarning[] = [];
  const merge = (xs: AmazonContentValidationWarning[]) => {
    for (const x of xs) {
      pushUnique(out, x.code, x.message);
    }
  };

  merge(validateAmazonTitle(values.amazonTitle));
  merge(validateAmazonDescription(values.amazonDescription));
  merge(
    validateAmazonBullets([
      values.amazonBullet1,
      values.amazonBullet2,
      values.amazonBullet3,
      values.amazonBullet4,
      values.amazonBullet5,
    ]),
  );
  merge(validateAmazonSearchTerms(values.amazonSearchTerms));
  merge(validateAmazonKeywords(values.amazonKeywords));

  return out;
}

export function validateAmazonMarketplaceDraft(
  draft: AmazonMarketplaceContentDraft,
): AmazonContentValidationWarning[] {
  return validateAmazonContent({
    amazonTitle: draft.title,
    amazonDescription: draft.description,
    amazonBullet1: draft.bullet1,
    amazonBullet2: draft.bullet2,
    amazonBullet3: draft.bullet3,
    amazonBullet4: draft.bullet4,
    amazonBullet5: draft.bullet5,
    amazonSearchTerms: draft.searchTerms,
    amazonKeywords: draft.keywords,
  });
}

function titleScore(warnings: AmazonContentValidationWarning[]): number {
  const hits = warnings.filter(
    (x) => x.code.startsWith("title_") || x.code === "bullets_count",
  ).length;
  return Math.max(0, 25 - hits * 5);
}

function descriptionScore(warnings: AmazonContentValidationWarning[]): number {
  const hits = warnings.filter((x) => x.code.startsWith("desc_")).length;
  return Math.max(0, 25 - hits * 6);
}

function bulletsScore(warnings: AmazonContentValidationWarning[]): number {
  const hits = warnings.filter(
    (x) => x.code.startsWith("bullet_") || x.code === "bullets_count",
  ).length;
  return Math.max(0, 25 - hits * 4);
}

function searchScore(warnings: AmazonContentValidationWarning[]): number {
  const hits = warnings.filter((x) =>
    x.code.startsWith("search_terms_"),
  ).length;
  return Math.max(0, 15 - hits * 5);
}

function keywordsScore(warnings: AmazonContentValidationWarning[]): number {
  const hits = warnings.filter((x) => x.code.startsWith("keywords_")).length;
  return Math.max(0, 10 - hits * 5);
}

/**
 * Puntuación orientativa 0–100 a partir de avisos (no sustituye validación SP-API).
 */
export function calculateAmazonContentQualityScore(
  warnings: AmazonContentValidationWarning[],
): AmazonContentQualityScore {
  const breakdown = {
    title: titleScore(warnings),
    description: descriptionScore(warnings),
    bullets: bulletsScore(warnings),
    searchTerms: searchScore(warnings),
    keywords: keywordsScore(warnings),
  };
  const overall = Math.min(
    100,
    breakdown.title +
      breakdown.description +
      breakdown.bullets +
      breakdown.searchTerms +
      breakdown.keywords,
  );
  return { overall, breakdown };
}
