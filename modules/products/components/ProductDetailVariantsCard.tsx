// modules/products/components/ProductDetailVariantsCard.tsx

type Props = {
    data: any;
    onOpenProduct: (productId: string) => void;
    onCreateVariant: () => void;
  };
  
  /**
   * Muestra padre, variantes hijas y hermanos.
   * Las variantes viven en la propia tabla productos mediante parent_id.
   */
  export function ProductDetailVariantsCard({
    data,
    onOpenProduct,
    onCreateVariant,
  }: Props) {
    const parent = data.parent;
    const variantes = data.variantes ?? [];
    const siblings = data.siblings ?? [];
  
    const hasVariants = variantes.length > 0;
    const hasSiblings = siblings.length > 0;
  
    return (
      <div className="card h-100 border-0 shadow-sm">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-start mb-3">
            <div>
              <h2 className="h5 mb-1">Variantes</h2>
              <div className="text-muted small">
                Relación padre/hijo y productos vinculados.
              </div>
            </div>
  
            <button
              type="button"
              className="btn btn-sm btn-outline-primary"
              onClick={onCreateVariant}
            >
              Añadir variante
            </button>
          </div>
  
          {parent && (
            <div className="border rounded p-3 mb-3 bg-light">
              <div className="text-muted small text-uppercase">Variante de</div>
              <button
                type="button"
                className="btn btn-link p-0 fw-semibold"
                onClick={() => onOpenProduct(parent.id)}
              >
                {parent.sku} · {parent.nombre}
              </button>
            </div>
          )}
  
          {hasVariants && (
            <div className="mb-3">
              <div className="text-muted small text-uppercase mb-2">
                Variantes hijas
              </div>
  
              <div className="list-group">
                {variantes.map((variant: any) => (
                  <button
                    key={variant.id}
                    type="button"
                    className="list-group-item list-group-item-action"
                    onClick={() => onOpenProduct(variant.id)}
                  >
                    <div className="fw-semibold">{variant.nombre}</div>
                    <div className="text-muted small">
                      {variant.sku}
                      {variant.heredar_precio ? " · precio heredado" : " · precio propio"}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
  
          {hasSiblings && (
            <div>
              <div className="text-muted small text-uppercase mb-2">
                Otras variantes del mismo padre
              </div>
  
              <div className="list-group">
                {siblings.map((sibling: any) => (
                  <button
                    key={sibling.id}
                    type="button"
                    className="list-group-item list-group-item-action"
                    onClick={() => onOpenProduct(sibling.id)}
                  >
                    <div className="fw-semibold">{sibling.nombre}</div>
                    <div className="text-muted small">{sibling.sku}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
  
          {!parent && !hasVariants && !hasSiblings && (
            <div className="text-muted small">
              Este producto no tiene variantes configuradas.
            </div>
          )}
        </div>
      </div>
    );
  }