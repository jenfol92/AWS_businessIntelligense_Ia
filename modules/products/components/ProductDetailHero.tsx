// modules/products/components/ProductDetailHero.tsx

type ProductDetailHeroProps = {
    producto: any;
    detalle: any;
    proveedor: any;
    parent: any;
    variantes: any[];
    siblings: any[];
  };
  
  // Bloque visual principal.
  // Resume identidad del producto, proveedor y relación con variantes.
  export function ProductDetailHero({
    producto,
    detalle,
    proveedor,
    parent,
    variantes,
    siblings,
  }: ProductDetailHeroProps) {
    const hasVariants = Array.isArray(variantes) && variantes.length > 0;
    const hasSiblings = Array.isArray(siblings) && siblings.length > 0;
  
    return (
      <div className="card border-0 shadow-sm">
        <div className="card-body">
          <div className="row g-4 align-items-start">
            <div className="col-md-3">
              <div className="ratio ratio-4x3 bg-light rounded overflow-hidden border">
                {detalle?.imagen_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={detalle.imagen_url}
                    alt={producto?.nombre ?? "Producto"}
                    className="w-100 h-100 object-fit-cover"
                  />
                ) : (
                  <div className="d-flex align-items-center justify-content-center text-muted small">
                    Sin imagen
                  </div>
                )}
              </div>
            </div>
  
            <div className="col-md-9">
              <div className="d-flex flex-wrap gap-2 mb-3">
                {producto?.estado && (
                  <span className="badge text-bg-secondary">{producto.estado}</span>
                )}
                {detalle?.categoria && (
                  <span className="badge text-bg-light border">{detalle.categoria}</span>
                )}
                {detalle?.marca && (
                  <span className="badge text-bg-light border">{detalle.marca}</span>
                )}
                {detalle?.color && (
                  <span className="badge text-bg-light border">{detalle.color}</span>
                )}
                {producto?.asin && (
                  <span className="badge text-bg-light border">ASIN: {producto.asin}</span>
                )}
              </div>
  
              <div className="row g-3">
                <div className="col-md-6">
                  <div className="small text-muted">Proveedor</div>
                  <div className="fw-semibold">{proveedor?.nombre ?? "Sin proveedor"}</div>
                  <div className="text-muted small">
                    {proveedor?.pais ?? "—"}
                    {proveedor?.puerto_preferido ? ` · Puerto ${proveedor.puerto_preferido}` : ""}
                  </div>
                </div>
  
                <div className="col-md-6">
                  <div className="small text-muted">Último pedido</div>
                  <div className="fw-semibold">
                    {producto?.last_ordered_at
                      ? new Date(producto.last_ordered_at).toLocaleDateString("es-ES")
                      : "—"}
                  </div>
                  <div className="text-muted small">
                    Stock seguridad mínimo: {producto?.stock_seguridad_minimo ?? 0}
                  </div>
                </div>
              </div>
  
              {(parent || hasVariants || hasSiblings) && (
                <div className="mt-4 p-3 rounded border bg-light">
                  {parent ? (
                    <>
                      <div className="small text-muted mb-1">Producto padre</div>
                      <div className="fw-semibold">
                        {parent?.sku} · {parent?.nombre}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="small text-muted mb-1">Variantes</div>
                      <div className="fw-semibold">
                        {variantes.length} variante{variantes.length === 1 ? "" : "s"}
                      </div>
                    </>
                  )}
  
                  {hasVariants && (
                    <div className="mt-3">
                      <div className="small text-muted mb-2">Listado de variantes</div>
                      <div className="d-flex flex-wrap gap-2">
                        {variantes.map((variant: any) => (
                          <span
                            key={variant.id}
                            className="badge rounded-pill text-bg-light border"
                          >
                            {variant.sku} · {variant.nombre}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
  
                  {hasSiblings && (
                    <div className="mt-3">
                      <div className="small text-muted mb-2">Otras variantes hermanas</div>
                      <div className="d-flex flex-wrap gap-2">
                        {siblings.map((sibling: any) => (
                          <span
                            key={sibling.id}
                            className="badge rounded-pill text-bg-light border"
                          >
                            {sibling.sku} · {sibling.nombre}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }