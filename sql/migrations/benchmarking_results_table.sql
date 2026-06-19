r-- Tabla para almacenar resultados de benchmarking con Amazon
CREATE TABLE IF NOT EXISTS public.benchmarking_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL,
  specifications JSONB NOT NULL DEFAULT '{}',
  amazon_products JSONB NOT NULL DEFAULT '[]',
  market_analysis JSONB NOT NULL DEFAULT '{}',
  recommendations JSONB NOT NULL DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  CONSTRAINT benchmarking_results_pkey PRIMARY KEY (id),
  CONSTRAINT benchmarking_results_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE,
  CONSTRAINT benchmarking_results_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);

-- Índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_benchmarking_results_producto_id ON public.benchmarking_results(producto_id);
CREATE INDEX IF NOT EXISTS idx_benchmarking_results_created_at ON public.benchmarking_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_benchmarking_results_gin ON public.benchmarking_results USING gin (specifications);

-- Comentarios
COMMENT ON TABLE public.benchmarking_results IS 'Resultados de análisis de benchmarking con productos de Amazon';
COMMENT ON COLUMN public.benchmarking_results.specifications IS 'Especificaciones del producto usado para el benchmarking';
COMMENT ON COLUMN public.benchmarking_results.amazon_products IS 'Array de productos similares encontrados en Amazon';
COMMENT ON COLUMN public.benchmarking_results.market_analysis IS 'Análisis del mercado: precios, ratings, saturación';
COMMENT ON COLUMN public.benchmarking_results.recommendations IS 'Recomendaciones estratégicas basadas en el análisis';