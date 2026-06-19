"use client";

import { useMemo, type ReactNode } from "react";
import type { useProductForm } from "../../../hooks/useProductForm";
import { validateAmazonContent } from "../../../validators/amazonContentValidator";

type Props = {
  form: ReturnType<typeof useProductForm>;
};

function CharHint({ current, max }: { current: number; max: number }) {
  return (
    <div className="form-text text-end">
      {current} / {max}
    </div>
  );
}

function AiBtn({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="btn btn-sm btn-outline-secondary"
      disabled
      title="Disponible en fase posterior"
    >
      {children}
    </button>
  );
}

export function ProductFormAmazonCommercialSection({ form }: Props) {
  const { values, updateField } = form;

  const warnings = useMemo(() => validateAmazonContent(values), [values]);

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-header bg-white d-flex flex-wrap justify-content-between gap-2 align-items-center">
        <div>
          <strong>Contenido comercial Amazon</strong>
          <div className="text-muted small fw-normal">
            Edición manual; avisos de estilo no bloquean el guardado.
          </div>
        </div>
        <div className="d-flex flex-wrap gap-1">
          <AiBtn>Generar descripción con IA</AiBtn>
          <AiBtn>Mejorar bullets</AiBtn>
          <AiBtn>Sugerir keywords</AiBtn>
          <AiBtn>Revisar cumplimiento Amazon</AiBtn>
          <AiBtn>Recomendar título SEO</AiBtn>
        </div>
      </div>
      <div className="card-body">
        {warnings.length > 0 && (
          <div className="alert alert-warning small mb-3">
            <strong>Avisos:</strong>
            <ul className="mb-0 mt-1">
              {warnings.map((w) => (
                <li key={w.code}>{w.message}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="row g-3">
          <div className="col-12">
            <label className="form-label">Título Amazon</label>
            <input
              className="form-control"
              value={values.amazonTitle}
              onChange={(e) => updateField("amazonTitle", e.target.value)}
              maxLength={250}
            />
            <CharHint current={values.amazonTitle.length} max={200} />
          </div>
          <div className="col-md-6">
            <label className="form-label">Marca (listado)</label>
            <input
              className="form-control"
              value={values.amazonBrand}
              onChange={(e) => updateField("amazonBrand", e.target.value)}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Idioma</label>
            <input
              className="form-control"
              value={values.amazonLanguage}
              onChange={(e) => updateField("amazonLanguage", e.target.value)}
              placeholder="es_ES"
            />
          </div>
          <div className="col-12">
            <label className="form-label">Descripción</label>
            <textarea
              className="form-control"
              rows={6}
              value={values.amazonDescription}
              onChange={(e) =>
                updateField("amazonDescription", e.target.value)
              }
            />
            <CharHint
              current={values.amazonDescription.length}
              max={4000}
            />
          </div>
          {(
            [
              ["amazonBullet1", "Bullet 1"],
              ["amazonBullet2", "Bullet 2"],
              ["amazonBullet3", "Bullet 3"],
              ["amazonBullet4", "Bullet 4"],
              ["amazonBullet5", "Bullet 5"],
            ] as const
          ).map(([key, label]) => (
            <div className="col-12" key={key}>
              <label className="form-label">{label}</label>
              <input
                className="form-control"
                value={values[key]}
                onChange={(e) => updateField(key, e.target.value)}
              />
              <CharHint current={values[key].length} max={500} />
            </div>
          ))}
          <div className="col-md-6">
            <label className="form-label">Keywords</label>
            <textarea
              className="form-control"
              rows={2}
              value={values.amazonKeywords}
              onChange={(e) =>
                updateField("amazonKeywords", e.target.value)
              }
            />
            <CharHint current={values.amazonKeywords.length} max={250} />
          </div>
          <div className="col-md-6">
            <label className="form-label">Público objetivo</label>
            <input
              className="form-control"
              value={values.amazonTargetAudience}
              onChange={(e) =>
                updateField("amazonTargetAudience", e.target.value)
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label">Search terms</label>
            <textarea
              className="form-control"
              rows={2}
              value={values.amazonSearchTerms}
              onChange={(e) =>
                updateField("amazonSearchTerms", e.target.value)
              }
            />
            <CharHint
              current={values.amazonSearchTerms.length}
              max={500}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label">Product type</label>
            <input
              className="form-control"
              value={values.amazonProductType}
              onChange={(e) =>
                updateField("amazonProductType", e.target.value)
              }
            />
          </div>
          <div className="col-md-4">
            <label className="form-label">Browse node ID</label>
            <input
              className="form-control"
              value={values.amazonBrowseNodeId}
              onChange={(e) =>
                updateField("amazonBrowseNodeId", e.target.value)
              }
            />
          </div>
          <div className="col-md-4">
            <label className="form-label">Condición</label>
            <select
              className="form-select"
              value={values.amazonConditionType}
              onChange={(e) =>
                updateField("amazonConditionType", e.target.value)
              }
            >
              <option value="new">new</option>
              <option value="used">used</option>
              <option value="refurbished">refurbished</option>
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label">Marketplace (contenido)</label>
            <input
              className="form-control"
              value={values.amazonMarketplace}
              onChange={(e) =>
                updateField("amazonMarketplace", e.target.value)
              }
              placeholder="ES, DE, ..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
