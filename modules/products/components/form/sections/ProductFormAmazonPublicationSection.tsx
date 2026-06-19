"use client";

import type { useProductForm } from "../../../hooks/useProductForm";
import type { AmazonListingStatus } from "../../../types";

type Props = {
  form: ReturnType<typeof useProductForm>;
};

export function ProductFormAmazonPublicationSection({ form }: Props) {
  const { values, updateField } = form;

  const setStatus = (s: AmazonListingStatus) =>
    updateField("amazonListingStatus", s);

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-header bg-white">
        <strong>Publicación en Amazon</strong>
        <div className="text-muted small fw-normal">
          Preparación para Selling Partner API (sin ejecución).
        </div>
      </div>
      <div className="card-body">
        <div className="row g-3">
          <div className="col-md-4 d-flex align-items-center">
            <div className="form-check">
              <input
                id="amazonSync"
                type="checkbox"
                className="form-check-input"
                checked={values.amazonSyncEnabled}
                onChange={(e) =>
                  updateField("amazonSyncEnabled", e.target.checked)
                }
              />
              <label className="form-check-label" htmlFor="amazonSync">
                Amazon sync habilitado
              </label>
            </div>
          </div>
          <div className="col-md-4">
            <label className="form-label">Estado listado</label>
            <select
              className="form-select"
              value={values.amazonListingStatus}
              onChange={(e) =>
                setStatus(e.target.value as AmazonListingStatus)
              }
            >
              <option value="draft">draft</option>
              <option value="ready">ready</option>
              <option value="active">active</option>
              <option value="error">error</option>
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label">Última sync (ISO)</label>
            <input
              className="form-control"
              value={values.amazonLastSyncAt}
              onChange={(e) =>
                updateField("amazonLastSyncAt", e.target.value)
              }
              placeholder="2026-01-01T12:00:00Z"
              readOnly
            />
            <div className="form-text">Rellenado por proceso futuro</div>
          </div>
          <div className="col-md-4">
            <label className="form-label">ASIN (listado)</label>
            <input
              className="form-control"
              value={values.amazonListingAsin}
              onChange={(e) =>
                updateField("amazonListingAsin", e.target.value)
              }
            />
          </div>
          <div className="col-md-4">
            <label className="form-label">SKU (listado)</label>
            <input
              className="form-control"
              value={values.amazonListingSku}
              onChange={(e) =>
                updateField("amazonListingSku", e.target.value)
              }
            />
          </div>
          <div className="col-md-4">
            <label className="form-label">Marketplace</label>
            <input
              className="form-control"
              value={values.amazonMarketplace}
              onChange={(e) =>
                updateField("amazonMarketplace", e.target.value)
              }
            />
          </div>
        </div>

        <div className="mt-3 d-flex flex-wrap gap-2 align-items-center">
          <button
            type="button"
            className="btn btn-primary"
            disabled
            title="SP-API en fase posterior"
          >
            Publicar/Actualizar en Amazon
          </button>
          <span className="text-muted small">
            Disponible en una fase posterior mediante Amazon Selling Partner
            API.
          </span>
        </div>

        <div className="alert alert-secondary small mt-4 mb-0">
          <strong>Regla futura (documentada):</strong> el envío a Amazon solo
          cuando <code>estado === &quot;activo&quot;</code>, existan SKU,
          marca, título y descripción Amazon, al menos 3 bullets, marketplace,
          categoría/product type, precio, y stock o estrategia de fulfillment.
        </div>
      </div>
    </div>
  );
}
