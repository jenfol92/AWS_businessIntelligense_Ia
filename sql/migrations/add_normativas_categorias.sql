-- Actualizar categorías con normativas específicas

-- Actualizar Carrito / Silla de paseo
UPDATE public.categorias 
SET campos_config = jsonb_set(
  campos_config, 
  '{campos}', 
  campos_config->'campos' || '[
    {
      "key": "normativa_aplicable",
      "label": "Normativa aplicable",
      "tipo": "select",
      "opciones": ["EN 1888-1 (hasta 15kg)", "EN 1888-2 (hasta 22kg)", "Ambas normativas"],
      "requerido": true,
      "ayuda_ia": "EN 1888-1 para carros básicos hasta 15kg, EN 1888-2 para carros hasta 22kg"
    },
    {
      "key": "requisitos_principales",
      "label": "Requisitos principales cumplidos",
      "tipo": "multi-select",
      "opciones": [
        "Estabilidad y resistencia", 
        "Sistema de frenado", 
        "Arnés de seguridad", 
        "Mecanismo de plegado seguro",
        "Protección contra aprisionamiento",
        "Materiales no tóxicos"
      ],
      "requerido": true,
      "ayuda_ia": "Requisitos obligatorios según normativa EN 1888"
    }
  ]'::jsonb
)
WHERE nombre = 'Carrito / Silla de paseo';

-- Actualizar Hamaca
UPDATE public.categorias 
SET campos_config = jsonb_set(
  campos_config, 
  '{campos}', 
  campos_config->'campos' || '[
    {
      "key": "normativa_hamaca",
      "label": "Normativa aplicable",
      "tipo": "select",
      "opciones": ["EN 12790-1 (hasta sentarse)", "EN 12790-2 (hasta ponerse de pie)"],
      "requerido": true,
      "ayuda_ia": "EN 12790-1 para bebés hasta que se sientan solos, EN 12790-2 hasta que se pongan de pie"
    },
    {
      "key": "sistemas_retencion",
      "label": "Sistemas de retención",
      "tipo": "multi-select",
      "opciones": [
        "Arnés de seguridad",
        "Barra de seguridad", 
        "Sistema anti-volcado",
        "Base antideslizante"
      ],
      "requerido": true,
      "ayuda_ia": "Sistemas obligatorios según EN 12790 para seguridad del bebé"
    }
  ]'::jsonb
)
WHERE nombre = 'Hamaca';

-- Actualizar Bicicleta
UPDATE public.categorias 
SET campos_config = jsonb_set(
  campos_config, 
  '{campos}', 
  campos_config->'campos' || '[
    {
      "key": "altura_sillin_mm",
      "label": "Altura sillín",
      "tipo": "text",
      "requerido": true,
      "ayuda_ia": "Rango 435-635mm según normativa, verificar ajuste al niño",
      "placeholder": "435-635 mm"
    },
    {
      "key": "peso_usuario_max",
      "label": "Peso máximo usuario",
      "tipo": "number",
      "unidad": "kg",
      "requerido": true,
      "ayuda_ia": "Típicamente ~30kg para bicicletas infantiles",
      "validacion": {"min": 15, "max": 50}
    },
    {
      "key": "normativa_bicicleta",
      "label": "Normativa aplicable",
      "tipo": "select",
      "opciones": ["EN 14765 (bicicletas infantiles)", "EN 14344 (bicicletas de ciudad)", "ISO 4210"],
      "requerido": true,
      "ayuda_ia": "EN 14765 específica para bicicletas infantiles"
    }
  ]'::jsonb
)
WHERE nombre = 'Bicicleta';

-- Actualizar Patinete
UPDATE public.categorias 
SET campos_config = jsonb_set(
  campos_config, 
  '{campos}', 
  campos_config->'campos' || '[
    {
      "key": "clasificacion_producto",
      "label": "Clasificación del producto",
      "tipo": "select",
      "opciones": ["Juguete (sin motor, <20km/h)", "Vehículo personal", "Patinete eléctrico"],
      "requerido": true,
      "ayuda_ia": "Clasificado como juguete si no tiene motor y velocidad <20km/h"
    },
    {
      "key": "normativa_patinete",
      "label": "Normativa aplicable",
      "tipo": "select",
      "opciones": ["EN 71-1,2,3 (juguetes)", "EN 14619 (patinetes)", "EN 17128 (patinetes eléctricos)"],
      "requerido": true,
      "ayuda_ia": "EN 71 si es juguete, EN 14619 para patinetes mecánicos"
    },
    {
      "key": "requisitos_seguridad_patinete",
      "label": "Requisitos de seguridad",
      "tipo": "multi-select",
      "opciones": [
        "Superficie antideslizante",
        "Sistema de frenado",
        "Resistencia estructural",
        "Elementos reflectantes",
        "Manillar con topes"
      ],
      "requerido": true,
      "ayuda_ia": "Requisitos básicos según normativas de patinetes"
    }
  ]'::jsonb
)
WHERE nombre = 'Patinete';

-- Actualizar Silleta para coche
UPDATE public.categorias 
SET campos_config = jsonb_set(
  campos_config, 
  '{campos}', 
  campos_config->'campos' || '[
    {
      "key": "test_seguridad_realizados",
      "label": "Tests de seguridad realizados",
      "tipo": "multi-select",
      "opciones": [
        "Impacto frontal",
        "Impacto lateral", 
        "Test de volcado",
        "Resistencia arnés",
        "Test temperatura extrema"
      ],
      "requerido": true,
      "ayuda_ia": "Tests obligatorios según ECE R44/04 y R129"
    },
    {
      "key": "etiqueta_homologacion",
      "label": "Etiqueta de homologación presente",
      "tipo": "boolean",
      "requerido": true,
      "ayuda_ia": "Etiqueta naranja obligatoria con número de homologación"
    }
  ]'::jsonb
)
WHERE nombre = 'Silleta para coche';

-- Actualizar todas las categorías con campo de cumplimiento CE
UPDATE public.categorias 
SET campos_config = jsonb_set(
  campos_config, 
  '{campos}', 
  campos_config->'campos' || '[
    {
      "key": "marcado_ce_presente",
      "label": "Marcado CE presente",
      "tipo": "boolean",
      "requerido": true,
      "ayuda_ia": "Obligatorio para todos los productos infantiles vendidos en la UE"
    },
    {
      "key": "declaracion_conformidad",
      "label": "Declaración de conformidad disponible",
      "tipo": "boolean",
      "requerido": true,
      "ayuda_ia": "Documento técnico que certifica cumplimiento de directivas europeas"
    }
  ]'::jsonb
)
WHERE nombre IN ('Trona', 'Bañera', 'Cuna', 'Juguetes', 'Juguetes eléctricos', 'Orinales');

COMMENT ON TABLE public.categorias IS 'Categorías actualizadas con normativas específicas europeas para productos infantiles';