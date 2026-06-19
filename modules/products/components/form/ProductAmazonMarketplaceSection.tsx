"use client";

/**
 * Amazon — marketplaces y contenido (UI): sin SP-API.
 * Identificador técnico: `amazon_marketplaces.id`. Etiquetas UI: nombre + código.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import type { useProductForm } from "../../hooks/useProductForm";
import type { AmazonListingStatus } from "../../types/product-amazon.types";
import {
  AMAZON_CONDITION_TYPES,
  AMAZON_CONTENT_LIMITS,
  AMAZON_LISTING_STATUSES,
  AMAZON_PRODUCT_TYPES,
} from "../../constants";
import { createDefaultAmazonMarketplaceDraft } from "../../constants/amazonMarketplaceDefaults";
import {
  calculateAmazonContentQualityScore,
  validateAmazonMarketplaceDraft,
} from "../../validators/amazonContentValidator";
import {
  pfCard,
  pfCardBody,
  pfCardHeader,
  pfCardSubtitle,
  pfCardTitle,
  pfFieldClass,
  pfGrid,
  pfLabel,
  pfSpan2,
  pfTextarea,
} from "./productFormUi";
import { ProductAmazonListingStatusBadge } from "./amazon/ProductAmazonListingStatusBadge";
import { ProductAmazonMarketplaceTabs } from "./amazon/ProductAmazonMarketplaceTabs";
import { ProductAmazonScoreBlock } from "./amazon/ProductAmazonScoreBlock";
import { ProductAmazonWarningsPanel } from "./amazon/ProductAmazonWarningsPanel";
import {
  amazonDraftHasMeaningfulContent,
  formatMarketplaceDisplayName,
  languageOptionsFromCatalog,
} from "./amazon/productAmazonHelpers";

type Props = {
  form: ReturnType<typeof useProductForm>;
};

function CharHint({ current, max }: { current: number; max: number }) {
  return (
    <div className="mt-0.5 text-right text-xs tabular-nums text-slate-400">
      {current} / {max}
    </div>
  );
}

function AiBtn({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300/90 bg-white px-2.5 py-2 text-xs font-medium leading-none text-slate-500 shadow-sm cursor-not-allowed opacity-70"
      disabled
      title="Disponible en fase posterior (sin OpenAI)"
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-400" aria-hidden />
      <span className="whitespace-nowrap">{children}</span>
    </button>
  );
}

export function ProductAmazonMarketplaceSection({ form }: Props) {
  const {
    values,
    toggleAmazonMarketplace,
    updateAmazonMarketplaceDraft,
    amazonCatalog,
    catalogLoading,
  } = form;
  const { assignedMarketplaceIds, contentByMarketplaceId } =
    values.amazonSetup;

  const [activeMpId, setActiveMpId] = useState<string | null>(null);

  useEffect(() => {
    if (assignedMarketplaceIds.length === 0) {
      setActiveMpId(null);
      return;
    }
    setActiveMpId((prev) =>
      prev && assignedMarketplaceIds.includes(prev)
        ? prev
        : assignedMarketplaceIds[0],
    );
  }, [assignedMarketplaceIds]);

  useEffect(() => {
    if (!activeMpId || !assignedMarketplaceIds.includes(activeMpId)) return;
    if (contentByMarketplaceId[activeMpId]) return;
    updateAmazonMarketplaceDraft(activeMpId, {});
  }, [
    activeMpId,
    assignedMarketplaceIds,
    contentByMarketplaceId,
    updateAmazonMarketplaceDraft,
  ]);

  const activeEntry =
    activeMpId != null
      ? amazonCatalog.find((c) => c.id === activeMpId)
      : undefined;

  const storedDraft =
    activeMpId != null ? contentByMarketplaceId[activeMpId] : undefined;

  const draft =
    activeMpId != null
      ? storedDraft ??
        createDefaultAmazonMarketplaceDraft(
          activeEntry?.languageCode?.trim() ?? "",
        )
      : null;

  const warnings = useMemo(
    () => (draft ? validateAmazonMarketplaceDraft(draft) : []),
    [draft],
  );

  const quality = useMemo(
    () => calculateAmazonContentQualityScore(warnings),
    [warnings],
  );

  const languageOptions = useMemo(
    () =>
      languageOptionsFromCatalog(
        amazonCatalog,
        draft?.languageCode ?? "",
      ),
    [amazonCatalog, draft?.languageCode],
  );

  function handleSelectMarketplaceTab(marketplaceId: string) {
    setActiveMpId(marketplaceId);
    if (!contentByMarketplaceId[marketplaceId]) {
      updateAmazonMarketplaceDraft(marketplaceId, {});
    }
  }

  function handleToggleMarketplace(marketplaceId: string, enabled: boolean) {
    if (!enabled) {
      const existing = contentByMarketplaceId[marketplaceId];
      if (existing && amazonDraftHasMeaningfulContent(existing)) {
        const name = formatMarketplaceDisplayName(
          amazonCatalog.find((c) => c.id === marketplaceId),
          marketplaceId,
        );
        const ok = window.confirm(
          `¿Quitar "${name}" de los marketplaces asignados?`,
        );
        if (!ok) return;
      }
    }
    toggleAmazonMarketplace(marketplaceId, enabled);
  }

  return (
    <section className={pfCard} aria-labelledby="product-section-amazon">
      <div className={pfCardHeader}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 id="product-section-amazon" className={pfCardTitle}>
              Amazon y marketplaces
            </h2>
            <p className={pfCardSubtitle}>
              Elige dónde publicar y edita el contenido comercial por país.
              Cada pestaña corresponde a un marketplace asignado.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-xl lg:justify-end">
            <AiBtn>Generar descripción con IA</AiBtn>
            <AiBtn>Mejorar bullets</AiBtn>
            <AiBtn>Sugerir keywords</AiBtn>
            <AiBtn>Revisar cumplimiento</AiBtn>
            <AiBtn>Recomendar título SEO</AiBtn>
          </div>
        </div>
      </div>
      <div className={pfCardBody}>
        {catalogLoading ? (
          <p className="mb-0 text-sm text-slate-500">
            Cargando catálogo de marketplaces…
          </p>
        ) : null}

        {!catalogLoading && amazonCatalog.length === 0 ? (
          <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            No hay marketplaces configurados. Añade filas en el catálogo
            para poder asignar destinos de publicación.
          </div>
        ) : null}

        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className={pfLabel}>Marketplaces asignados a este producto</div>
          <p className="mt-1 text-xs text-slate-500">
            Marca los destinos donde quieres mantener contenido y estado de
            listado.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {amazonCatalog.map((row) => {
              const checked = assignedMarketplaceIds.includes(row.id);
              return (
                <label
                  key={row.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                    checked
                      ? "border-blue-200 bg-blue-50/40 ring-1 ring-blue-500/10"
                      : "border-slate-200 bg-slate-50/50 hover:border-slate-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30"
                    disabled={catalogLoading}
                    checked={checked}
                    onChange={(e) =>
                      handleToggleMarketplace(row.id, e.target.checked)
                    }
                  />
                  <span className="min-w-0 text-sm font-medium leading-snug text-slate-800">
                    {formatMarketplaceDisplayName(row, row.id)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {assignedMarketplaceIds.length === 0 ? (
          <p className="mb-0 text-sm text-slate-500">
            Selecciona al menos un marketplace para ver las pestañas de
            contenido.
          </p>
        ) : null}

        {assignedMarketplaceIds.length > 0 && activeMpId && draft ? (
          <div className="space-y-5">
            <ProductAmazonMarketplaceTabs
              assignedIds={assignedMarketplaceIds}
              activeId={activeMpId}
              catalog={amazonCatalog}
              onSelect={handleSelectMarketplaceTab}
            />

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-[0.06em] text-slate-500">
                    Contenido para
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-900">
                    {formatMarketplaceDisplayName(activeEntry, activeMpId)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ProductAmazonListingStatusBadge
                    status={draft.listingStatus}
                  />
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <ProductAmazonScoreBlock
                  quality={quality}
                  warnings={warnings}
                />
                <ProductAmazonWarningsPanel warnings={warnings} />
              </div>

              <div className={`${pfGrid} mt-5 border-t border-slate-100 pt-5`}>
                <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-end sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <label className={pfLabel} htmlFor="amazon-listing-status">
                      Estado listado
                    </label>
                    <select
                      id="amazon-listing-status"
                      className={pfFieldClass(false)}
                      value={draft.listingStatus}
                      onChange={(e) =>
                        updateAmazonMarketplaceDraft(activeMpId, {
                          listingStatus: e.target.value as AmazonListingStatus,
                        })
                      }
                    >
                      {AMAZON_LISTING_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-3">
                    <input
                      id={`sync-en-${activeMpId}`}
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30"
                      checked={draft.syncEnabled}
                      onChange={(e) =>
                        updateAmazonMarketplaceDraft(activeMpId, {
                          syncEnabled: e.target.checked,
                        })
                      }
                    />
                    <label
                      className="text-sm text-slate-700"
                      htmlFor={`sync-en-${activeMpId}`}
                    >
                      Sync habilitado
                    </label>
                  </div>
                </div>

                <div>
                  <label className={pfLabel} htmlFor="amazon-lang">
                    Idioma contenido
                  </label>
                  <select
                    id="amazon-lang"
                    className={pfFieldClass(false)}
                    value={draft.languageCode}
                    onChange={(e) =>
                      updateAmazonMarketplaceDraft(activeMpId, {
                        languageCode: e.target.value,
                      })
                    }
                  >
                    {languageOptions.map((lang) => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={pfLabel} htmlFor="amazon-brand">
                    Marca (listado)
                  </label>
                  <input
                    id="amazon-brand"
                    className={pfFieldClass(false)}
                    value={draft.brand}
                    onChange={(e) =>
                      updateAmazonMarketplaceDraft(activeMpId, {
                        brand: e.target.value,
                      })
                    }
                  />
                </div>
                <div className={pfSpan2}>
                  <label className={pfLabel} htmlFor="amazon-title">
                    Título Amazon
                  </label>
                  <input
                    id="amazon-title"
                    className={pfFieldClass(false)}
                    value={draft.title}
                    onChange={(e) =>
                      updateAmazonMarketplaceDraft(activeMpId, {
                        title: e.target.value,
                      })
                    }
                    maxLength={AMAZON_CONTENT_LIMITS.titleMaxLength}
                  />
                  <CharHint
                    current={draft.title.length}
                    max={AMAZON_CONTENT_LIMITS.titleMaxLength}
                  />
                </div>
                <div className={pfSpan2}>
                  <label className={pfLabel} htmlFor="amazon-desc">
                    Descripción
                  </label>
                  <textarea
                    id="amazon-desc"
                    className={pfTextarea}
                    rows={6}
                    value={draft.description}
                    onChange={(e) =>
                      updateAmazonMarketplaceDraft(activeMpId, {
                        description: e.target.value,
                      })
                    }
                  />
                  <CharHint
                    current={draft.description.length}
                    max={AMAZON_CONTENT_LIMITS.descriptionMaxLength}
                  />
                </div>
                {(
                  [
                    ["bullet1", "Bullet 1"],
                    ["bullet2", "Bullet 2"],
                    ["bullet3", "Bullet 3"],
                    ["bullet4", "Bullet 4"],
                    ["bullet5", "Bullet 5"],
                  ] as const
                ).map(([key, label]) => (
                  <div className={pfSpan2} key={key}>
                    <label className={pfLabel} htmlFor={`amazon-${key}`}>
                      {label}
                    </label>
                    <input
                      id={`amazon-${key}`}
                      className={pfFieldClass(false)}
                      value={draft[key]}
                      onChange={(e) =>
                        updateAmazonMarketplaceDraft(activeMpId, {
                          [key]: e.target.value,
                        })
                      }
                    />
                    <CharHint
                      current={draft[key].length}
                      max={AMAZON_CONTENT_LIMITS.bulletMaxLength}
                    />
                  </div>
                ))}
                <div>
                  <label className={pfLabel} htmlFor="amazon-keywords">
                    Keywords
                  </label>
                  <textarea
                    id="amazon-keywords"
                    className={pfTextarea}
                    rows={3}
                    value={draft.keywords}
                    onChange={(e) =>
                      updateAmazonMarketplaceDraft(activeMpId, {
                        keywords: e.target.value,
                      })
                    }
                  />
                  <CharHint
                    current={draft.keywords.length}
                    max={250}
                  />
                </div>
                <div>
                  <label className={pfLabel} htmlFor="amazon-audience">
                    Público objetivo
                  </label>
                  <input
                    id="amazon-audience"
                    className={pfFieldClass(false)}
                    value={draft.targetAudience}
                    onChange={(e) =>
                      updateAmazonMarketplaceDraft(activeMpId, {
                        targetAudience: e.target.value,
                      })
                    }
                  />
                </div>
                <div className={pfSpan2}>
                  <label className={pfLabel} htmlFor="amazon-search">
                    Search terms
                  </label>
                  <textarea
                    id="amazon-search"
                    className={pfTextarea}
                    rows={3}
                    value={draft.searchTerms}
                    onChange={(e) =>
                      updateAmazonMarketplaceDraft(activeMpId, {
                        searchTerms: e.target.value,
                      })
                    }
                  />
                  <CharHint
                    current={draft.searchTerms.length}
                    max={AMAZON_CONTENT_LIMITS.searchTermsMaxLength}
                  />
                </div>
                <div>
                  <label className={pfLabel} htmlFor="amazon-ptype">
                    Product type
                  </label>
                  <input
                    id="amazon-ptype"
                    className={pfFieldClass(false)}
                    list={`amazon-product-types-${activeMpId}`}
                    value={draft.productType}
                    onChange={(e) =>
                      updateAmazonMarketplaceDraft(activeMpId, {
                        productType: e.target.value,
                      })
                    }
                  />
                  <datalist id={`amazon-product-types-${activeMpId}`}>
                    {AMAZON_PRODUCT_TYPES.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className={pfLabel} htmlFor="amazon-browse">
                    Browse node ID
                  </label>
                  <input
                    id="amazon-browse"
                    className={pfFieldClass(false)}
                    value={draft.browseNodeId}
                    onChange={(e) =>
                      updateAmazonMarketplaceDraft(activeMpId, {
                        browseNodeId: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className={pfLabel} htmlFor="amazon-condition">
                    Condición
                  </label>
                  <select
                    id="amazon-condition"
                    className={pfFieldClass(false)}
                    value={draft.conditionType}
                    onChange={(e) =>
                      updateAmazonMarketplaceDraft(activeMpId, {
                        conditionType: e.target.value,
                      })
                    }
                  >
                    {AMAZON_CONDITION_TYPES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={pfLabel} htmlFor="amazon-asin">
                    ASIN (listado)
                  </label>
                  <input
                    id="amazon-asin"
                    className={pfFieldClass(false)}
                    value={draft.listingAsin}
                    onChange={(e) =>
                      updateAmazonMarketplaceDraft(activeMpId, {
                        listingAsin: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className={pfLabel} htmlFor="amazon-sku">
                    SKU (listado Amazon)
                  </label>
                  <input
                    id="amazon-sku"
                    className={pfFieldClass(false)}
                    value={draft.listingSku}
                    onChange={(e) =>
                      updateAmazonMarketplaceDraft(activeMpId, {
                        listingSku: e.target.value,
                      })
                    }
                  />
                </div>
                <div className={pfSpan2}>
                  <label className={pfLabel} htmlFor="amazon-sync-at">
                    Última sync (ISO)
                  </label>
                  <input
                    id="amazon-sync-at"
                    className={`${pfFieldClass(false)} bg-slate-50`}
                    value={draft.lastSyncAt}
                    onChange={(e) =>
                      updateAmazonMarketplaceDraft(activeMpId, {
                        lastSyncAt: e.target.value,
                      })
                    }
                    readOnly
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Rellenado por proceso futuro
                  </p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
                <button
                  type="button"
                  className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm opacity-50 cursor-not-allowed"
                  disabled
                  title="SP-API en fase posterior"
                >
                  Publicar/Actualizar en Amazon
                </button>
                <span className="text-xs text-slate-500">
                  Disponible después vía Selling Partner API.
                </span>
              </div>

              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs text-slate-700">
                <p className="font-semibold text-slate-800">
                  Regla futura (documentada)
                </p>
                <p className="mb-0 mt-1 leading-relaxed">
                  Envío a Amazon solo con producto activo, SKU, marca, título y
                  descripción por marketplace, mínimo 3 bullets, marketplace /
                  product type, precio y stock o fulfillment definido.
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
