-- Migración para implementar ficha técnica dinámica
-- Fecha: 2024-04-16

-- 1. Añadir columna especificaciones JSONB a la tabla productos
ALTER TABLE public.productos 
ADD COLUMN IF NOT EXISTS especificaciones JSONB DEFAULT '{}';

-- 2. Crear tabla de categorías con configuración de campos dinámicos
CREATE TABLE IF NOT EXISTS public.categorias (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  descripcion text,
  campos_config JSONB NOT NULL DEFAULT '{}',
  es_activa boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT categorias_pkey PRIMARY KEY (id)
);

-- 3. Crear índices para optimizar consultas JSONB
CREATE INDEX IF NOT EXISTS idx_productos_especificaciones_gin 
ON public.productos USING gin (especificaciones);

CREATE INDEX IF NOT EXISTS idx_categorias_campos_config_gin 
ON public.categorias USING gin (campos_config);

-- 4. Insertar categorías específicas de productos de bebé/niño
INSERT INTO public.categorias (nombre, descripcion, campos_config) VALUES 
(
  'Carrito / Silla de paseo',
  'Carritos y sillas de paseo para bebés y niños',
  '{
    "campos": [
      {
        "key": "edad_minima_meses",
        "label": "Edad mínima",
        "tipo": "number",
        "unidad": "meses",
        "requerido": true,
        "ayuda_ia": "Edad mínima según desarrollo del bebé (0 meses para capazo, 6 meses para silla)",
        "validacion": {"min": 0, "max": 48}
      },
      {
        "key": "peso_maximo_nino",
        "label": "Peso máximo del niño",
        "tipo": "number",
        "unidad": "kg",
        "requerido": true,
        "ayuda_ia": "Peso máximo soportado según normativa EN 1888",
        "validacion": {"min": 9, "max": 25}
      },
      {
        "key": "tipo_carrito",
        "label": "Tipo de carrito",
        "tipo": "select",
        "opciones": ["Trio (capazo+silla+silla auto)", "Duo (capazo+silla)", "Silla de paseo", "Paraguas/Ligera", "Gemelar"],
        "requerido": true,
        "ayuda_ia": "Clasificación según funcionalidad y accesorios incluidos"
      },
      {
        "key": "posiciones_respaldo",
        "label": "Posiciones del respaldo",
        "tipo": "number",
        "unidad": "posiciones",
        "requerido": true,
        "ayuda_ia": "Número de posiciones reclinables (mínimo 3 recomendado)",
        "validacion": {"min": 1, "max": 10}
      },
      {
        "key": "ruedas_tipo",
        "label": "Tipo de ruedas",
        "tipo": "select",
        "opciones": ["3 ruedas todo terreno", "4 ruedas ciudad", "4 ruedas todo terreno", "Ruedas giratorias", "Ruedas fijas"],
        "requerido": true,
        "ayuda_ia": "Tipo de ruedas según uso previsto (ciudad vs todo terreno)"
      },
      {
        "key": "peso_carrito",
        "label": "Peso del carrito",
        "tipo": "number",
        "unidad": "kg",
        "requerido": true,
        "ayuda_ia": "Peso del carrito vacío (importante para transporte)",
        "validacion": {"min": 3, "max": 20}
      },
      {
        "key": "sistema_plegado",
        "label": "Sistema de plegado",
        "tipo": "select",
        "opciones": ["Una mano", "Dos manos", "Automático", "Compacto", "Paraguas"],
        "requerido": true,
        "ayuda_ia": "Facilidad de plegado (una mano es más práctico)"
      },
      {
        "key": "homologacion_r44_r129",
        "label": "Homologación R44/R129",
        "tipo": "boolean",
        "requerido": true,
        "ayuda_ia": "Obligatorio para sillas de auto incluidas en trios"
      }
    ]
  }'::jsonb
),
(
  'Patinete',
  'Patinetes para niños y bebés',
  '{
    "campos": [
      {
        "key": "edad_recomendada_min",
        "label": "Edad mínima",
        "tipo": "number",
        "unidad": "años",
        "requerido": true,
        "ayuda_ia": "Edad mínima según desarrollo motor del niño",
        "validacion": {"min": 1, "max": 12}
      },
      {
        "key": "peso_maximo_soportado",
        "label": "Peso máximo",
        "tipo": "number",
        "unidad": "kg",
        "requerido": true,
        "ayuda_ia": "Capacidad máxima según estructura y materiales",
        "validacion": {"min": 20, "max": 100}
      },
      {
        "key": "numero_ruedas",
        "label": "Número de ruedas",
        "tipo": "select",
        "opciones": ["2 ruedas", "3 ruedas", "4 ruedas"],
        "requerido": true,
        "ayuda_ia": "3-4 ruedas más estable para principiantes, 2 ruedas para avanzados"
      },
      {
        "key": "altura_regulable",
        "label": "Altura regulable",
        "tipo": "boolean",
        "requerido": true,
        "ayuda_ia": "Imprescindible para crecer con el niño"
      },
      {
        "key": "sistema_direccion",
        "label": "Sistema de dirección",
        "tipo": "select",
        "opciones": ["Inclinación (lean-to-steer)", "Manillar tradicional", "Mixto"],
        "requerido": true,
        "ayuda_ia": "Inclinación más intuitivo para niños pequeños"
      },
      {
        "key": "tipo_freno",
        "label": "Tipo de freno",
        "tipo": "select",
        "opciones": ["Freno trasero pie", "Freno manillar", "Ambos", "Sin freno"],
        "requerido": true,
        "ayuda_ia": "Freno esencial para seguridad, trasero más fácil para niños"
      },
      {
        "key": "material_plataforma",
        "label": "Material plataforma",
        "tipo": "select",
        "opciones": ["Plástico antideslizante", "Aluminio rugoso", "Madera", "Fibra de vidrio"],
        "requerido": true,
        "ayuda_ia": "Antideslizante obligatorio para seguridad"
      }
    ]
  }'::jsonb
),
(
  'Bicicleta',
  'Bicicletas para bebés y niños',
  '{
    "campos": [
      {
        "key": "tamano_rueda",
        "label": "Tamaño de rueda",
        "tipo": "select",
        "opciones": ["12 pulgadas", "14 pulgadas", "16 pulgadas", "18 pulgadas", "20 pulgadas", "24 pulgadas"],
        "requerido": true,
        "ayuda_ia": "12-14\" para 2-4 años, 16\" para 4-6 años, 20\" para 6-9 años"
      },
      {
        "key": "edad_recomendada",
        "label": "Edad recomendada",
        "tipo": "text",
        "requerido": true,
        "ayuda_ia": "Rango de edad según tamaño y características",
        "placeholder": "2-4 años"
      },
      {
        "key": "ruedines_incluidos",
        "label": "Ruedines incluidos",
        "tipo": "boolean",
        "requerido": true,
        "ayuda_ia": "Esenciales para aprendizaje, deben ser desmontables"
      },
      {
        "key": "sillita_portabebe",
        "label": "Sillita portabebé",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Para llevar bebé adicional, requiere homologación"
      },
      {
        "key": "tipo_frenos",
        "label": "Tipo de frenos",
        "tipo": "select",
        "opciones": ["Contrapedal (retrógrado)", "Frenos V-brake", "Frenos disco", "Sin frenos"],
        "requerido": true,
        "ayuda_ia": "Contrapedal más intuitivo para niños pequeños"
      },
      {
        "key": "ajuste_asiento_manillar",
        "label": "Ajuste asiento y manillar",
        "tipo": "boolean",
        "requerido": true,
        "ayuda_ia": "Imprescindible para adaptar al crecimiento del niño"
      },
      {
        "key": "material_cuadro",
        "label": "Material del cuadro",
        "tipo": "select",
        "opciones": ["Acero", "Aluminio", "Fibra de carbono", "Magnesio"],
        "requerido": true,
        "ayuda_ia": "Aluminio ligero y resistente, acero más pesado pero económico"
      },
      {
        "key": "protector_cadena",
        "label": "Protector de cadena",
        "tipo": "boolean",
        "requerido": true,
        "ayuda_ia": "Obligatorio para seguridad infantil, evita enganches"
      }
    ]
  }'::jsonb
),
(
  'Trona',
  'Tronas y sillas de comer para bebés',
  '{
    "campos": [
      {
        "key": "edad_uso_minima",
        "label": "Edad mínima de uso",
        "tipo": "number",
        "unidad": "meses",
        "requerido": true,
        "ayuda_ia": "Normalmente 6 meses cuando el bebé se mantiene sentado",
        "validacion": {"min": 3, "max": 12}
      },
      {
        "key": "peso_max_soportado",
        "label": "Peso máximo",
        "tipo": "number",
        "unidad": "kg",
        "requerido": true,
        "ayuda_ia": "Según normativa EN 14988, mínimo 15kg recomendado",
        "validacion": {"min": 10, "max": 30}
      },
      {
        "key": "alturas_regulables",
        "label": "Alturas regulables",
        "tipo": "number",
        "unidad": "posiciones",
        "requerido": true,
        "ayuda_ia": "Mínimo 3 alturas para adaptarse a diferentes mesas",
        "validacion": {"min": 1, "max": 10}
      },
      {
        "key": "respaldo_reclinable",
        "label": "Respaldo reclinable",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Útil para descanso del bebé durante comidas largas"
      },
      {
        "key": "bandeja_desmontable",
        "label": "Bandeja desmontable",
        "tipo": "boolean",
        "requerido": true,
        "ayuda_ia": "Imprescindible para limpieza e higiene"
      },
      {
        "key": "sistema_seguridad",
        "label": "Sistema de seguridad",
        "tipo": "select",
        "opciones": ["Arnés 3 puntos", "Arnés 5 puntos", "Barra de seguridad", "Cinturón básico"],
        "requerido": true,
        "ayuda_ia": "Arnés 5 puntos más seguro según normativa"
      },
      {
        "key": "tipo_trona",
        "label": "Tipo de trona",
        "tipo": "select",
        "opciones": ["Trona alta tradicional", "Trona evolutiva", "Trona portátil", "Elevador silla"],
        "requerido": true,
        "ayuda_ia": "Evolutiva crece con el niño, portátil para viajes"
      },
      {
        "key": "material_estructura",
        "label": "Material estructura",
        "tipo": "select",
        "opciones": ["Madera", "Metal", "Plástico", "Mixto"],
        "requerido": true,
        "ayuda_ia": "Madera estética pero pesada, metal ligero y resistente"
      }
    ]
  }'::jsonb
),
(
  'Hamaca',
  'Hamacas y mecedoras para bebés',
  '{
    "campos": [
      {
        "key": "edad_maxima_uso",
        "label": "Edad máxima de uso",
        "tipo": "number",
        "unidad": "meses",
        "requerido": true,
        "ayuda_ia": "Normalmente hasta 6-9 meses o cuando se sientan solos",
        "validacion": {"min": 6, "max": 18}
      },
      {
        "key": "peso_maximo_bebe",
        "label": "Peso máximo bebé",
        "tipo": "number",
        "unidad": "kg",
        "requerido": true,
        "ayuda_ia": "Según normativa EN 12790, típicamente 9-11kg",
        "validacion": {"min": 6, "max": 15}
      },
      {
        "key": "tipo_balanceo",
        "label": "Tipo de balanceo",
        "tipo": "select",
        "opciones": ["Manual", "Eléctrico", "Vibraciones", "Mixto"],
        "requerido": true,
        "ayuda_ia": "Eléctrico más cómodo, manual más económico"
      },
      {
        "key": "velocidades_balanceo",
        "label": "Velocidades de balanceo",
        "tipo": "number",
        "unidad": "velocidades",
        "requerido": false,
        "ayuda_ia": "Múltiples velocidades permiten adaptarse al bebé",
        "validacion": {"min": 1, "max": 10}
      },
      {
        "key": "musica_sonidos",
        "label": "Música y sonidos",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Estimula el desarrollo auditivo del bebé"
      },
      {
        "key": "juguetes_moviles",
        "label": "Juguetes/móviles",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Estimula desarrollo visual y motor"
      },
      {
        "key": "tipo_alimentacion",
        "label": "Tipo de alimentación",
        "tipo": "select",
        "opciones": ["Pilas", "Batería recargable", "Cable AC", "Mixto"],
        "requerido": false,
        "ayuda_ia": "Batería recargable más económica a largo plazo"
      },
      {
        "key": "material_funda",
        "label": "Material de la funda",
        "tipo": "select",
        "opciones": ["Algodón", "Poliéster", "Mezcla algodón-poliéster", "Bambú"],
        "requerido": true,
        "ayuda_ia": "Algodón más suave, debe ser lavable en máquina"
      }
    ]
  }'::jsonb
),
(
  'Bañera',
  'Bañeras para bebés y accesorios de baño',
  '{
    "campos": [
      {
        "key": "edad_uso_hasta",
        "label": "Edad de uso hasta",
        "tipo": "number",
        "unidad": "meses",
        "requerido": true,
        "ayuda_ia": "Según tamaño del bebé, típicamente hasta 12-18 meses",
        "validacion": {"min": 6, "max": 36}
      },
      {
        "key": "capacidad_agua",
        "label": "Capacidad de agua",
        "tipo": "number",
        "unidad": "litros",
        "requerido": true,
        "ayuda_ia": "Entre 20-40 litros según tamaño de bañera",
        "validacion": {"min": 10, "max": 80}
      },
      {
        "key": "tipo_banera",
        "label": "Tipo de bañera",
        "tipo": "select",
        "opciones": ["Bañera básica", "Con soporte/patas", "Plegable", "Hinchable", "Para ducha adulto"],
        "requerido": true,
        "ayuda_ia": "Con soporte evita dolores de espalda a los padres"
      },
      {
        "key": "indicador_temperatura",
        "label": "Indicador de temperatura",
        "tipo": "select",
        "opciones": ["Sin indicador", "Color termosensible", "Termómetro digital", "Pegatina térmica"],
        "requerido": false,
        "ayuda_ia": "Seguridad crítica, temperatura óptima 37°C"
      },
      {
        "key": "superficie_antideslizante",
        "label": "Superficie antideslizante",
        "tipo": "boolean",
        "requerido": true,
        "ayuda_ia": "Obligatorio para seguridad del bebé"
      },
      {
        "key": "soporte_recien_nacido",
        "label": "Soporte recién nacido",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Hamaca o reductor para primeros meses"
      },
      {
        "key": "material_banera",
        "label": "Material bañera",
        "tipo": "select",
        "opciones": ["Plástico PP", "Plástico PVC", "Silicona", "Fibra de vidrio"],
        "requerido": true,
        "ayuda_ia": "PP libre de BPA, más seguro para bebés"
      },
      {
        "key": "desague_integrado",
        "label": "Desagüe integrado",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Facilita el vaciado y limpieza"
      }
    ]
  }'::jsonb
),
(
  'Cuna',
  'Cunas y moisés para bebés',
  '{
    "campos": [
      {
        "key": "edad_uso_hasta",
        "label": "Edad de uso hasta",
        "tipo": "number",
        "unidad": "años",
        "requerido": true,
        "ayuda_ia": "Cuna estándar hasta 3-4 años, moisés hasta 6 meses",
        "validacion": {"min": 0.5, "max": 6}
      },
      {
        "key": "medidas_colchon",
        "label": "Medidas colchón",
        "tipo": "select",
        "opciones": ["60x120 cm", "70x140 cm", "80x160 cm", "40x80 cm (moisés)", "Personalizada"],
        "requerido": true,
        "ayuda_ia": "60x120 cm estándar europeo, 70x140 cm cuna grande"
      },
      {
        "key": "barrotes_separacion",
        "label": "Separación barrotes",
        "tipo": "number",
        "unidad": "cm",
        "requerido": true,
        "ayuda_ia": "Entre 4.5-6.5 cm según normativa EN 716 para seguridad",
        "validacion": {"min": 4, "max": 7}
      },
      {
        "key": "somier_regulable",
        "label": "Somier regulable",
        "tipo": "number",
        "unidad": "alturas",
        "requerido": true,
        "ayuda_ia": "Mínimo 2 alturas, alta para recién nacido, baja cuando se incorpora",
        "validacion": {"min": 1, "max": 5}
      },
      {
        "key": "barrotes_abatibles",
        "label": "Barrotes abatibles",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Facilita acceso al bebé, debe tener doble seguro"
      },
      {
        "key": "convertible_cama",
        "label": "Convertible a cama",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Cuna evolutiva, se usa hasta 6-8 años como cama infantil"
      },
      {
        "key": "material_estructura",
        "label": "Material estructura",
        "tipo": "select",
        "opciones": ["Madera maciza", "MDF lacado", "Metal", "Ratán", "Mixto"],
        "requerido": true,
        "ayuda_ia": "Madera maciza más duradera, MDF más económico"
      },
      {
        "key": "acabado_pintura",
        "label": "Acabado y pintura",
        "tipo": "select",
        "opciones": ["Barniz al agua", "Laca sin tóxicos", "Aceite natural", "Sin tratar"],
        "requerido": true,
        "ayuda_ia": "Solo barnices/lacas certificados sin tóxicos para bebés"
      },
      {
        "key": "ruedas_desplazamiento",
        "label": "Ruedas desplazamiento",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Con frenos de seguridad, útil para limpieza"
      }
    ]
  }'::jsonb
),
(
  'Juguetes',
  'Juguetes tradicionales para bebés y niños',
  '{
    "campos": [
      {
        "key": "edad_minima",
        "label": "Edad mínima",
        "tipo": "number",
        "unidad": "meses",
        "requerido": true,
        "ayuda_ia": "Según desarrollo motor y cognitivo del niño",
        "validacion": {"min": 0, "max": 144}
      },
      {
        "key": "edad_maxima", 
        "label": "Edad máxima",
        "tipo": "number",
        "unidad": "años",
        "requerido": false,
        "ayuda_ia": "Edad hasta la cual mantiene interés",
        "validacion": {"min": 1, "max": 14}
      },
      {
        "key": "habilidades_desarrollo",
        "label": "Habilidades que desarrolla",
        "tipo": "multi-select",
        "opciones": ["Motricidad fina", "Motricidad gruesa", "Coordinación", "Lenguaje", "Lógica", "Creatividad", "Social"],
        "requerido": true,
        "ayuda_ia": "Fundamental para desarrollo integral del niño"
      },
      {
        "key": "material_principal",
        "label": "Material principal",
        "tipo": "select",
        "opciones": ["Plástico ABS", "Madera natural", "Tela", "Silicona alimentaria", "Goma natural", "Metal"],
        "requerido": true,
        "ayuda_ia": "Debe ser no tóxico y resistente a mordidas"
      },
      {
        "key": "piezas_pequenas",
        "label": "Contiene piezas pequeñas",
        "tipo": "boolean",
        "requerido": true,
        "ayuda_ia": "Crítico para seguridad, piezas <3cm peligrosas antes 3 años"
      },
      {
        "key": "tipo_juguete",
        "label": "Tipo de juguete",
        "tipo": "select",
        "opciones": ["Mordedor", "Sonajero", "Peluche", "Construcción", "Puzzle", "Arrastre", "Encajable", "Musical"],
        "requerido": true,
        "ayuda_ia": "Clasificación según funcionalidad principal"
      },
      {
        "key": "lavable_maquina",
        "label": "Lavable en máquina",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Importante para higiene, especialmente primeros años"
      },
      {
        "key": "certificacion_ce",
        "label": "Marcado CE",
        "tipo": "boolean",
        "requerido": true,
        "ayuda_ia": "Obligatorio para venta en UE según Directiva de Seguridad de Juguetes"
      }
    ]
  }'::jsonb
),
(
  'Juguetes eléctricos',
  'Juguetes con componentes eléctricos/electrónicos',
  '{
    "campos": [
      {
        "key": "edad_recomendada_min",
        "label": "Edad mínima",
        "tipo": "number",
        "unidad": "años",
        "requerido": true,
        "ayuda_ia": "Mínimo 3 años para juguetes eléctricos según normativas",
        "validacion": {"min": 3, "max": 14}
      },
      {
        "key": "voltaje_funcionamiento",
        "label": "Voltaje de funcionamiento",
        "tipo": "select",
        "opciones": ["1.5V (pilas AA)", "3V (pilas AAA)", "6V (batería)", "12V (batería)", "24V (batería)"],
        "requerido": true,
        "ayuda_ia": "Máximo 24V para seguridad infantil según normativa"
      },
      {
        "key": "tipo_alimentacion",
        "label": "Tipo de alimentación",
        "tipo": "select",
        "opciones": ["Pilas desechables", "Batería recargable", "Cable adaptador", "Panel solar"],
        "requerido": true,
        "ayuda_ia": "Batería recargable más ecológica y económica"
      },
      {
        "key": "funciones_principales",
        "label": "Funciones principales",
        "tipo": "multi-select",
        "opciones": ["Luces", "Sonidos", "Movimiento", "Música", "Voz", "Interactivo", "Control remoto"],
        "requerido": true,
        "ayuda_ia": "Define el tipo de estimulación que proporciona"
      },
      {
        "key": "nivel_volumen_regulable",
        "label": "Volumen regulable",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Recomendable para proteger audición infantil"
      },
      {
        "key": "resistencia_agua",
        "label": "Resistencia al agua",
        "tipo": "select",
        "opciones": ["No resistente", "Salpicaduras (IPX1)", "Lluvia ligera (IPX4)", "Inmersión (IPX7)"],
        "requerido": true,
        "ayuda_ia": "Importante si se usa en exterior o baño"
      },
      {
        "key": "certificaciones",
        "label": "Certificaciones",
        "tipo": "multi-select",
        "opciones": ["CE", "FCC", "RoHS", "REACH", "EN 62115 (seguridad eléctrica)"],
        "requerido": true,
        "ayuda_ia": "EN 62115 específica para seguridad eléctrica en juguetes"
      },
      {
        "key": "tiempo_juego_continuo",
        "label": "Tiempo juego continuo",
        "tipo": "number",
        "unidad": "horas",
        "requerido": false,
        "ayuda_ia": "Autonomía importante para satisfacción del niño",
        "validacion": {"min": 0.5, "max": 50}
      }
    ]
  }'::jsonb
),
(
  'Silleta para coche',
  'Sillas de seguridad infantil para automóvil',
  '{
    "campos": [
      {
        "key": "grupo_normativa",
        "label": "Grupo normativa",
        "tipo": "select",
        "opciones": ["Grupo 0 (0-10kg)", "Grupo 0+ (0-13kg)", "Grupo I (9-18kg)", "Grupo II (15-25kg)", "Grupo III (22-36kg)"],
        "requerido": true,
        "ayuda_ia": "Según peso del niño y normativa ECE R44/04 o R129 i-Size"
      },
      {
        "key": "normativa_homologacion",
        "label": "Normativa homologación",
        "tipo": "select",
        "opciones": ["ECE R44/04", "ECE R129 (i-Size)", "Ambas"],
        "requerido": true,
        "ayuda_ia": "i-Size más reciente, mejores tests laterales"
      },
      {
        "key": "sistema_instalacion",
        "label": "Sistema de instalación",
        "tipo": "select",
        "opciones": ["Cinturón de seguridad", "ISOFIX", "ISOFIX + Top Tether", "i-Size (ISOFIX)"],
        "requerido": true,
        "ayuda_ia": "ISOFIX más seguro y fácil instalación"
      },
      {
        "key": "orientacion_viaje",
        "label": "Orientación de viaje",
        "tipo": "select",
        "opciones": ["Solo contramarcha", "Solo frente marcha", "Ambas orientaciones", "Giratoria 360°"],
        "requerido": true,
        "ayuda_ia": "Contramarcha hasta 4 años mínimo por seguridad"
      },
      {
        "key": "edades_uso",
        "label": "Edades de uso",
        "tipo": "text",
        "requerido": true,
        "ayuda_ia": "Rango de edades según grupo y tamaño",
        "placeholder": "0-4 años"
      },
      {
        "key": "reclinacion_posiciones",
        "label": "Posiciones reclinación",
        "tipo": "number",
        "unidad": "posiciones",
        "requerido": true,
        "ayuda_ia": "Mínimo 2 posiciones, importante para comodidad y sueño",
        "validacion": {"min": 1, "max": 8}
      },
      {
        "key": "proteccion_lateral",
        "label": "Protección lateral",
        "tipo": "boolean",
        "requerido": true,
        "ayuda_ia": "SIP (Side Impact Protection) esencial para impactos laterales"
      },
      {
        "key": "base_separada",
        "label": "Base separada",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Facilita cambio entre coches, común en Grupo 0+"
      },
      {
        "key": "funda_lavable",
        "label": "Funda lavable",
        "tipo": "boolean",
        "requerido": true,
        "ayuda_ia": "Imprescindible para higiene infantil"
      }
    ]
  }'::jsonb
),
(
  'Orinales',
  'Orinales y reductores WC para aprendizaje',
  '{
    "campos": [
      {
        "key": "edad_inicio_uso",
        "label": "Edad inicio uso",
        "tipo": "number",
        "unidad": "meses",
        "requerido": true,
        "ayuda_ia": "Normalmente entre 18-24 meses según desarrollo del niño",
        "validacion": {"min": 12, "max": 48}
      },
      {
        "key": "tipo_orinal",
        "label": "Tipo de orinal",
        "tipo": "select",
        "opciones": ["Orinal básico", "Orinal musical", "Reductor WC", "Orinal con escalón", "WC portátil"],
        "requerido": true,
        "ayuda_ia": "Orinal básico para inicio, reductor WC para transición"
      },
      {
        "key": "material_principal",
        "label": "Material principal",
        "tipo": "select",
        "opciones": ["Plástico PP", "Plástico ABS", "Silicona", "Mixto plástico-goma"],
        "requerido": true,
        "ayuda_ia": "PP más higiénico y resistente para uso frecuente"
      },
      {
        "key": "superficie_antideslizante",
        "label": "Base antideslizante",
        "tipo": "boolean",
        "requerido": true,
        "ayuda_ia": "Esencial para seguridad y confianza del niño"
      },
      {
        "key": "respaldo_ergonomico",
        "label": "Respaldo ergonómico",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Proporciona comodidad y seguridad al niño"
      },
      {
        "key": "recipiente_extraible",
        "label": "Recipiente extraíble",
        "tipo": "boolean",
        "requerido": true,
        "ayuda_ia": "Facilita limpieza e higiene del orinal"
      },
      {
        "key": "efectos_sonoros",
        "label": "Efectos sonoros",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Motiva y hace más divertido el aprendizaje"
      },
      {
        "key": "asa_transporte",
        "label": "Asa de transporte",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Útil para llevarlo en viajes o entre habitaciones"
      },
      {
        "key": "compatibilidad_wc",
        "label": "Compatible con WC estándar",
        "tipo": "boolean",
        "requerido": false,
        "ayuda_ia": "Solo para reductores WC, importante verificar medidas"
      }
    ]
  }'::jsonb
)
ON CONFLICT (nombre) DO NOTHING;

-- 5. Función para validar estructura de campos_config
CREATE OR REPLACE FUNCTION validar_campos_config(config JSONB) 
RETURNS BOOLEAN AS $$
BEGIN
  -- Verificar que tenga estructura básica
  IF NOT (config ? 'campos' AND jsonb_typeof(config->'campos') = 'array') THEN
    RETURN FALSE;
  END IF;
  
  -- Verificar que cada campo tenga las propiedades mínimas
  IF EXISTS (
    SELECT 1 
    FROM jsonb_array_elements(config->'campos') AS campo
    WHERE NOT (campo ? 'key' AND campo ? 'label' AND campo ? 'tipo')
  ) THEN
    RETURN FALSE;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 6. Restricción para validar campos_config
ALTER TABLE public.categorias
ADD CONSTRAINT check_campos_config_valido 
CHECK (validar_campos_config(campos_config));

-- 7. Trigger para actualizar updated_at en categorias
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_categorias_updated_at
BEFORE UPDATE ON public.categorias
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 8. Comentarios para documentación
COMMENT ON TABLE public.categorias IS 'Categorías de productos con configuración dinámica de campos técnicos';
COMMENT ON COLUMN public.categorias.campos_config IS 'Configuración JSONB de campos específicos por categoría';
COMMENT ON COLUMN public.productos.especificaciones IS 'Especificaciones técnicas dinámicas según categoría';