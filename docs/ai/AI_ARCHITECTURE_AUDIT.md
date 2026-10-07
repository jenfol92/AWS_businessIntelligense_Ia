## 1. Resumen ejecutivo

[RECOMENDACIÓN] La base más razonable es **mantener el ERP como propietario de datos, permisos y reglas de negocio, y añadir progresivamente una capa de ejecución de tareas con tools controladas**.

[VERIFICADO EN REPOSITORIO] El proyecto utiliza Next.js App Router, TypeScript y Supabase; contiene servicios y repositorios reutilizables, especialmente en productos, inventario, compras, planificación, finanzas y Amazon SP-API.

[VERIFICADO EN REPOSITORIO] La IA actual es un esqueleto: un clasificador por palabras, dos tools vacías y componentes de voz incompletos. No encontré integración funcional con modelos.

[VERIFICADO EN REPOSITORIO] Existen automatizaciones deterministas, cron, estados de sincronización, locks, RPC financieras e idempotencia en operaciones concretas. No existe una plataforma general de workflows empresariales.

[INFERENCIA] La principal dificultad no es elegir un framework agéntico: es definir límites reutilizables y seguros sobre una arquitectura todavía desigual.

[RECOMENDACIÓN] Comenzaría con TypeScript y un caso de consulta acotado. Incorporaría n8n cuando los casos reales justifiquen conectores y edición visual; LangGraph cuando justifiquen ejecución agéntica con estado; un motor durable cuando las esperas y recuperaciones lo requieran.

[RECOMENDACIÓN] No establecería un agente por departamento. Los departamentos deberían definir casos de uso y permisos; las capacidades deberían organizarse por tareas y recursos.

[VERIFICADO EN REPOSITORIO] Hay riesgos relevantes: autorización heterogénea, lecturas mediante service role, escrituras no atómicas y subidas a Drive que intentan conceder lectura pública.

[NO VERIFICADO] Despliegue, políticas efectivamente aplicadas, datos actuales, configuración remota y funcionamiento en producción.

La auditoría fue exclusivamente de lectura. No modifiqué archivos, ejecuté migraciones, instalé dependencias, hice commits ni lancé sincronizaciones.

## 2. Arquitectura actual verificada

### Alcance y significado de la evidencia

[VERIFICADO EN REPOSITORIO] Inspeccioné la estructura, los manifiestos, las rutas, los módulos y los principales recorridos entre API, servicios, repositorios y SQL. Las búsquedas de IA incluyeron proveedores, SDK, agentes, tools, prompts, memoria, embeddings, RAG, orquestación y observabilidad.

**“Verificado” significa que existe en este checkout, no que esté desplegado ni probado funcionalmente.** Hay cambios locales previos y archivos sin seguimiento, incluidos desarrollos recientes de tesorería.

[NO VERIFICADO] No se ejecutaron build, tests ni consultas remotas. No se realizó una lectura línea por línea de todos los archivos ni un análisis formal de dependencias circulares.

### Mapa real

```text
Navegador
 |
 +-- Supabase Auth: inicio de sesión
 |
 +-- Next.js App Router
 |    app/[locale]/(dashboard)/*
 |    componentes en modules/*/components
 |    DashboardShell + filtros compartidos
 |
 +-- /api/*
      |
      +-- Validación/autorización específica de cada ruta
      |    - getUser en numerosas rutas
      |    - requireFinanceAccess en finanzas
      |    - CRON_SECRET en procesos programados
      |
      +-- Servicios de dominio y cálculo
      |    products / inventory / planner / planning
      |    orders / containers / finance / suppliers
      |
      +-- Repositorios
      |    - cliente Supabase vinculado a cookies
      |    - cliente Supabase service role en ciertos recorridos
      |
      +-- Acceso directo desde algunas rutas a Supabase/Drive
      |
      +-- Integraciones servidor
           Amazon SP-API / Google Drive / BCE

Supabase / PostgreSQL
 |
 +-- Tablas y vistas de negocio
 +-- RPC, triggers, constraints y políticas RLS
 +-- Snapshots, identidad de fuentes y estados de sincronización
 +-- Storage

Programación declarada en vercel.json
 |
 +-- Rutas cron
      +-- Scheduler de informes Amazon
      +-- Sincronización financiera Amazon
      +-- Importación de ventas FBA

IA actual, recorrido separado:
POST /api/ai/chat
 -> runBusinessAgent
 -> selección por message.includes(...)
 -> dos tools stub que devuelven []
```

[VERIFICADO EN REPOSITORIO] El diagrama representa los recorridos inspeccionados. No representa microservicios independientes.

### Stack y organización

| Elemento | Evidencia y estado |
|---|---|
| Framework | [VERIFICADO EN REPOSITORIO] `package-lock.json`: Next.js **14.2.35**, React **18.3.1**, TypeScript **5.9.3**, `@supabase/supabase-js` **2.105.3**. Son versiones del lockfile. |
| Next.js | [VERIFICADO EN REPOSITORIO] `app/[locale]`, grupos `(auth)` y `(dashboard)`, Route Handlers en `app/api`, `next-intl`, middleware de sesión/localización. |
| Backend | [VERIFICADO EN REPOSITORIO] Backend integrado en Next.js; servicios, repositorios y utilidades en `modules/` y `server/`. |
| APIs | [VERIFICADO EN REPOSITORIO] 133 archivos reales `route.ts` en el inventario realizado. Algunos devuelven 501; el número no equivale a 133 capacidades completas. |
| Estructura incompleta | [VERIFICADO EN REPOSITORIO] Hay también directorios llamados `route.ts`, por ejemplo `app/api/ai/field-suggestion/route.ts`. No son Route Handlers implementados. |
| Datos | [VERIFICADO EN REPOSITORIO] SQL en `sql/tables`, `views`, `migrations`, `diagnostics`, `repairs`, `rollback`. Conviven migraciones, propuestas y scripts históricos. |
| Tipado DB | [VERIFICADO EN REPOSITORIO] `server/db/database.types.ts` y `server/supabase/types.ts` están vacíos. |
| Auth | [VERIFICADO EN REPOSITORIO] Supabase Auth; cliente navegador para login y clientes SSR/route con cookies. |
| Roles | [VERIFICADO EN REPOSITORIO] `admin`, `accounting`, `logistics`, obtenidos de `app_metadata.role` en `server/auth/adminAuthorization.ts`. |
| Configuración | [VERIFICADO EN REPOSITORIO] Variables de entorno utilizadas directamente y validadores específicos de integración. `config/env.ts`, `permissions.ts` y `featureFlags.ts` están vacíos. |
| Infraestructura | [VERIFICADO EN REPOSITORIO] `vercel.json` declara tres cron. [NO VERIFICADO] Hosting efectivo, workers desplegados, límites y disponibilidad. |

### Madurez por dominio

| Dominio | Implementación encontrada |
|---|---|
| Productos | [VERIFICADO EN REPOSITORIO] Catálogo, ficha, variantes/herencia, costes, ventas, documentos, configuración Amazon y selección de competidores. Algunas rutas siguen siendo placeholders. |
| Inventario | [VERIFICADO EN REPOSITORIO] Dashboard comparativo, detalle, forecast, snapshots canónicos Amazon y modelos de lectura por pool/marketplace. |
| Compras | [VERIFICADO EN REPOSITORIO] Órdenes, borradores, confirmación, reapertura, operaciones sobre confirmadas, proformas y pagos asociados. |
| Logística | [VERIFICADO EN REPOSITORIO] Contenedores, destinos de stock, costes, enlaces con órdenes y envíos Amazon. |
| Finanzas | [VERIFICADO EN REPOSITORIO] Planificación, tesorería, pagos proveedor, líneas de crédito, obligaciones, pagos recurrentes e ingresos Amazon. |
| Contabilidad completa | [NO VERIFICADO] No encontré evidencia suficiente de un sistema completo de asientos, mayor, cierres e impuestos. Finanzas operativas no demuestra esa cobertura. |
| Ventas | [VERIFICADO EN REPOSITORIO] Datos y consultas de ventas en productos/inventario/importaciones Amazon. [NO VERIFICADO] CRM o ciclo comercial completo. |
| Marketing | [VERIFICADO EN REPOSITORIO] SQL de Ads y referencias a métricas publicitarias. [NO VERIFICADO] Gestión operativa de campañas o integración activa con Advertising API. |
| BI | [VERIFICADO EN REPOSITORIO] `modules/dashboard/components/DashboardBI.tsx` tiene código. Los 33 archivos de `modules/bi` están vacíos. |
| Alertas/documentos | [VERIFICADO EN REPOSITORIO] `modules/alerts` y `modules/documents` están vacíos. Documentos sí tienen implementación en rutas específicas y `modules/drive`. |
| Amazon | [VERIFICADO EN REPOSITORIO] `modules/amazon-sp-api` contiene implementación extensa. El árbol antiguo `modules/amazon` inspeccionado está vacío. |

### Integraciones, procesos y observabilidad

[VERIFICADO EN REPOSITORIO]

- **Amazon:** `lwaClient.ts`, `spApiClient.ts`, `reportsClient.ts`, `financesClient.ts`, `listingsItemsClient.ts`, servicios de snapshots e inbound.
- **Drive:** `modules/drive/googleDriveService.ts` y OAuth asociado.
- **BCE:** `modules/finance/services/ecbFxService.ts`, con consulta de tipos de cambio y tratamiento de valoración no disponible.
- **Scheduler:** `amazonReportSchedulerService.ts` y repositorio con estados, expiración de locks y heartbeat.
- **Cron declarados:** informes cada hora; sincronización financiera cada 30 minutos; importación de ventas a las 05:20 según la expresión configurada.
- **Observabilidad específica:** registros `console`, telemetría de Inventory Summaries, request IDs Amazon y resultados de sincronización.
- **Errores:** `SpApiError`/mapeadores, errores financieros tipados y respuestas heterogéneas en otros dominios.
- **Tests:** pruebas `.test.mjs`/`.test.ts`, scripts y diagnósticos SQL; algunas pruebas PostgreSQL utilizan PGlite.

[NO VERIFICADO] No encontré una cola general, un bus de eventos, webhooks empresariales operativos, tracing distribuido general ni una integración CI de tests. Los dos archivos de `server/jobs` están vacíos: no prueban jobs funcionales.

## 3. Inventario de IA existente

Todos los estados de esta tabla están **[VERIFICADO EN REPOSITORIO]**; su despliegue es **[NO VERIFICADO]**.

| Ruta | Qué hace y consumidor | Dependencias | Estado | Acoplamiento |
|---|---|---|---|---|
| `app/api/ai/chat/route.ts:6–14` | Recibe JSON y llama a `runBusinessAgent`; el hook de voz apunta aquí. | Next.js, módulo IA. | Parcial; endpoint con implementación. | Acoplado al contrato informal `message/userId`. |
| `modules/ai/agent/businessAgent.ts:6–33` | Busca palabras como `margen`, `rentabilidad`, `stock`, `pedir`. | Dos funciones stub. | Prototipo determinista; sin modelo. | Bajo con negocio real. |
| `modules/ai/tools/getProfitabilityTool.ts` | Devuelve `[]`; consumida por `businessAgent`. | Ninguna integración. | Stub. | Ninguno con rentabilidad real. |
| `modules/ai/tools/getStockCoverageTool.ts` | Devuelve `[]`; consumida por `businessAgent`. | Ninguna integración. | Stub. | Ninguno con inventario real. |
| `modules/ai/tools/*` restantes | Nombres para productos, proveedores, ventas, órdenes y creación de compra. | No hay implementación. | Vacíos. | No demostrable. |
| `modules/ai/agent/toolRegistry.ts`, `systemPrompt.ts`, `memory.ts`, `agentRouter.ts`, `intentClassifier.ts`, `responseFormatter.ts` | Archivos reservados. | Ninguna ejecución demostrada. | Vacíos. | Ninguno efectivo. |
| `modules/ai/services/*`, `schemas/*`, `repositories/*` | Incluyen `aiClient`, `runChat`, memoria y conversaciones. | No hay implementación. | Vacíos. | Ninguno efectivo. |
| `modules/ai/components/*`, `hooks/*` | Estructura de interfaz de chat/asistente. | No hay implementación. | Vacíos. | Ninguno efectivo. |
| `modules/ai/voice/VoiceAssistantButton.tsx` | Botón que llama al hook de voz. | React, hook local. | Parcial; no encontré montaje en la UI. | Bajo. |
| `modules/ai/voice/useVoiceAssistant.ts:12–46` | Transcribir → HTTP → reproducir respuesta. | `fetch`, stubs locales. | Flujo incompleto. | Acoplado a `/api/ai/chat`. |
| `recordAndTranscribe.ts`, `speak.ts` | Devuelven `null` y no-op respectivamente. | Ningún proveedor. | Stubs. | Ninguno efectivo. |
| `prompts/*.txt` | Instrucciones para desarrollo/documentación y evitar duplicados. | Uso humano/asistente de desarrollo. | Documentación; no prompts de runtime. | No encontré carga desde la aplicación. |
| `.agents/AGENTS.md`, `.agents/skills/*` | Guía y herramientas de desarrollo. | Entorno de desarrollo. | No son agentes del ERP. | No encontré conexión de runtime. |
| `docs/architecture/AMAZON_SP_API_SECURITY_DESIGN_GUARDRAILS.md:286–298` | Requisitos documentales relativos a IA y datos Amazon. | Gobernanza del proyecto. | Documento, no control ejecutable. | Relevante para futuras integraciones. |

[VERIFICADO EN REPOSITORIO] De los 44 archivos de `modules/ai`, 37 estaban vacíos.

[NO VERIFICADO] No encontré implementación funcional de OpenAI, Anthropic, Gemini, modelos locales, Vercel AI SDK, LangChain, LangGraph, LlamaIndex, n8n, MCP de aplicación, embeddings, pgvector, RAG, memoria persistente, structured outputs, evaluación de modelos ni tracing de agentes.

**La palabra “agente” en `agentes_compra` representa agentes de compras del negocio, no agentes de IA.**

## 4. Capacidades reutilizables como tools

[RECOMENDACIÓN] La clasificación distingue:

- **READ TOOL:** consulta o cálculo sin modificar negocio.
- **WRITE TOOL:** modifica registros del ERP.
- **EXTERNAL ACTION:** cambia estado fuera del ERP.

Una consulta externa, aunque no escriba negocio, también necesita límites de cuota, coste y exposición de datos.

Las implementaciones descritas están **[VERIFICADO EN REPOSITORIO]**. La posibilidad de exponerlas y los cambios son **[RECOMENDACIÓN]**.

### Contratos y reglas existentes

| ID / capacidad / dominio | Implementación y archivos | Entrada → salida | Reglas y efectos |
|---|---|---|---|
| T1. Catálogo — productos — **READ** | `getProductCatalog.ts`; `productCatalogRepository.ts`; `/api/products/catalog` | Búsqueda, filtros, limit/offset → productos, opciones, paginación. | Búsqueda normalizada, deduplicación y límite ampliado para búsqueda. Sin escritura observada. |
| T2. Ficha y costes — productos — **READ** | `getProductDetail.ts:39+`; repositorios `productCosts`, `productVariants`, `productProfitability` | Producto, país, canal, ventana → ficha compuesta. | Herencia padre/hijo, precio efectivo, costes y rentabilidad. Puede devolver información financiera sensible. |
| T3. Ventas de producto — ventas — **READ** | `productSalesRepository.ts:14–53`; consumido por `getProductDetail` | Producto, ventana, país, canal → serie de ventas y campos económicos. | Consulta `ventas_diarias`. El selector inspeccionado no incluye moneda: no generalizar sumas monetarias sin aclarar ese contrato. |
| T4. Inventario canónico — inventario — **READ** | `amazonCanonicalInventoryReadModel.ts:37+`; `/api/inventory/amazon-canonical` | Producto/ASIN/pool/límite → stock, procedencia y estado de sincronización. | Respeta distinción de pools y snapshots completos; lectura mediante admin client. |
| T5. Riesgo/cobertura — inventario — **READ** | `buildInventoryDashboard.ts`; `/api/inventory/comparison:15–40` | Filtros y canal → comparativa, productos y resumen. | Reutilizar cálculo existente; no copiar ranking de UI como nueva verdad de negocio. |
| T6. Forecast/reposición — planificación — **READ** | `buildProductInventoryForecast.ts`; `analyzeProducts.ts:196+`; `/api/planning/analyze` | Producto, escenario, horizonte, país/canal, overrides → previsiones y recomendaciones. | Simulación y decisiones deterministas; mantener hipótesis, procedencia y límites del histórico. |
| T7. Proveedores — compras — **READ** | `suppliersRepository.ts`; `/api/suppliers:26–40` | Búsqueda, país, puerto, agente, completitud → proveedores. | Filtrado y completitud ya implementados. Datos de contacto requieren alcance. |
| T8. Órdenes — compras — **READ / WRITE separadas** | `ordersRepository.ts`: `listOrders`, `getOrderWithItems`, `createOrderDraft`, `confirmOrder`; `/api/orders/*` | Filtros/ID o propuesta de orden → orden/resultado. | Borrador y confirmado tienen comportamientos diferentes; confirmar afecta costes y planificación de pagos. |
| T9. Tesorería prevista — finanzas — **READ** | `buildFinancialPlanning.ts:812+`; `/api/finance/planning:41–67` | Mes inicial y 1–18 meses → calendario/plan y frescura Amazon. | La ruta distingue acceso a detalles según rol. No debería disparar sync para responder. |
| T10. Registrar pago/recepción — finanzas — **WRITE** | `supplierPaymentExecutionService.ts`; ruta `mark-paid`; `operatingFlowService.ts`; ruta `amazon-income/[id]/receive` | Obligación/ingreso, cuenta, importe, fecha, idempotencia → resultado financiero. | RPC, reglas de fondos y estados. Registrar recepción no equivale a verificar por sí mismo un ingreso bancario. |
| T11. Aplicar stock — logística — **WRITE** | `applyContainerStock.ts:23–173`; `containerStockRepository.ts` | Contenedor, usuario → resultado, advertencias y resumen. | Evita aplicar stock Amazon manualmente en casos previstos. Inserta trazas y después ejecuta RPC por destino. |
| T12. Documentos — transversal — **READ / EXTERNAL ACTION separadas** | Rutas de documentos de producto/contenedor; `googleDriveService.ts` | Recurso/documento/archivo → metadata, descarga o ID Drive. | Subir, crear carpetas y borrar cambian Drive; además se persisten relaciones en ERP. |
| T13. Competidores — producto/planificación — **READ / WRITE separadas** | `getProductBenchmarkCompetitors.ts`; `saveProductBenchmarkSelection.ts` | Producto/país → snapshots; selección/pesos → configuración. | Pesos y captación validados entre 0 y 1. No demuestra scraper operativo. |
| T14. Sincronización Amazon — integración — **WRITE + EXTERNAL ACTION** | `amazonReportSchedulerService.ts`; `amazonFinancialPlanningSync.ts`; servicios FBA/FBM | Dominio, periodo/modo → run, snapshots y diagnósticos. | Crear informes produce estado externo; persistir snapshots modifica ERP. Debe conservar un único propietario por sincronización. |
| T15. Forecast económico Amazon V2 — finanzas — **READ con llamadas externas** | `buildAmazonEconomicForecastV2.ts:20–24`; `/api/finance/amazon-economic-forecast-v2` | Fecha de referencia → previsión económica. | Consulta Finances, BCE y, si falta evidencia persistida, informes Amazon. No es una consulta puramente local. |

### Permisos, preparación y riesgo

| ID | Permisos actuales observados | ¿Tool? | Cambios necesarios | Riesgo |
|---|---|---|---|---|
| T1 | Cliente de sesión; ruta sin `getUser` explícito. RLS efectivo no verificado. | Sí, tras controles. | Autorización explícita, salida mínima y contratos versionados. | Medio. |
| T2–T3 | Repositorios con cliente de sesión; sin política granular en estas funciones. | Parcial. | Separar catálogo público interno de costes/ventas; moneda y completitud. | Medio/alto por interpretación y confidencialidad. |
| T4 | Ruta exige usuario; servicio usa service role. | Parcial. | Contexto y scopes explícitos antes del acceso privilegiado. | Alto si se amplía a varias empresas. |
| T5–T6 | Inventario exige usuario; `/planning/analyze` no muestra guard explícito. | Sí, con adaptación. | Homogeneizar autorización, limitar consultas y publicar hipótesis. | Medio. |
| T7 | `getUser` en ruta. | Sí. | Minimización de contactos y permiso de lectura. | Bajo/medio. |
| T8 | `getUser`; reglas en repositorios/RPC. | Lectura sí; escritura parcial. | Separar crear borrador, confirmar y reabrir; approval e idempotencia por comando. | Alto para confirmación/reapertura. |
| T9 | `requireTreasuryAccess`; detalles para admin/accounting. | Sí, preservando proyecciones por rol. | Contexto explícito, frescura y salida acotada. | Medio/alto. |
| T10 | `requireFinanceDetailsAccess`, validaciones y RPC financieras. | Parcial; fuera del primer piloto. | Aprobación vinculada a payload, evidencia, estado y revalidación. | Crítico. |
| T11 | Ruta autenticada y usuario en trazabilidad. | No como escritura autónoma actual. | Resolver atomicidad y recuperación antes de permitir retries automáticos. | Alto. |
| T12 | Autenticación en rutas específicas; credencial Drive administrativa. | Lectura parcial; escritura restringida. | ACL por recurso, revisión de publicación, autorización de borrado y compensación. | Alto. |
| T13 | Validación de selección; contrato de permisos por tool pendiente. | Sí para lectura; parcial para escritura. | Proveniencia, antigüedad y aprobación de cambios que afectan forecast. | Medio. |
| T14 | Secretos cron/controles según entrada; acceso privilegiado. | Parcial, preferiblemente comando de job. | Solicitar ejecución al propietario existente; no exponer transporte SP-API arbitrario. | Alto por cuotas y publicación. |
| T15 | `requireFinanceDetailsAccess`. | Parcial. | Presupuesto de llamadas, cache, timeouts y distinción local/externo. | Alto en coste operativo y datos. |

[NO VERIFICADO] No hay tools reutilizables demostradas para enviar campañas, ejecutar transferencias bancarias, enviar correos comerciales o gestionar un CRM. No deben aparecer como capacidades disponibles.

## 5. Carencias/bloqueantes

La severidad se refiere a **habilitar agentes empresariales**, especialmente con escrituras, no a declarar inutilizable todo el ERP.

| Severidad | Evidencia | Implicación |
|---|---|---|
| **BLOQUEANTE** | [VERIFICADO EN REPOSITORIO] `/api/ai/chat:6–12` no autentica, no valida `message` y acepta `userId` del body. `businessAgent` ignora ese ID. | [RECOMENDACIÓN] No conectar tools reales antes de introducir identidad confiable y autorización. Hoy las tools vacías limitan el alcance del riesgo. |
| **BLOQUEANTE para multempresa** | [VERIFICADO EN REPOSITORIO] Lecturas con `supabaseAdmin` en inventario y finanzas; no encontré contexto transversal de empresa ni filtros `tenant_id/company_id/organization_id`. | [NO VERIFICADO] Aislamiento multempresa. [RECOMENDACIÓN] Decidir si es requisito y demostrarlo antes de compartir datos entre organizaciones. |
| **BLOQUEANTE para datos sensibles en Drive** | [VERIFICADO EN REPOSITORIO] `googleDriveService.ts:201–203` solicita permiso `{role:"reader", type:"anyone"}`. | [RECOMENDACIÓN] Revisar política de publicación antes de automatizar documentos. [NO VERIFICADO] Permisos efectivos de archivos ya subidos. |
| **BLOQUEANTE para retries de stock** | [VERIFICADO EN REPOSITORIO] `applyContainerStock.ts:131–149`: inserta trazas y después llama a `fn_stock_add` en bucle; contempla fallo parcial. | [INFERENCIA] Reintentar automáticamente puede encontrar trazas de una aplicación incompleta. Se necesita atomicidad o recuperación explícita. |
| **BLOQUEANTE para writes sensibles** | [NO VERIFICADO] No encontré aprobación durable ligada a una acción concreta, argumentos y versión de recurso. | [RECOMENDACIÓN] Un diálogo de confirmación o permiso de rol no sustituye aprobación verificable de la ejecución agéntica. |
| **IMPORTANTE** | [VERIFICADO EN REPOSITORIO] `finance_supplier_payments_rls.sql` permite select/insert/update a `authenticated` con condiciones amplias; otras migraciones endurecen RPC por rol. | [INFERENCIA] Hay que comprobar grants y políticas finales: endurecer la RPC no prueba que la escritura directa quede cerrada. |
| **IMPORTANTE** | [VERIFICADO EN REPOSITORIO] `middleware.ts:112` excluye `/api`; catálogo, creación de producto y análisis de planner no tienen guard explícito en la ruta. | [NO VERIFICADO] No demuestra acceso anónimo efectivo, porque interviene RLS. Sí demuestra que no existe una garantía uniforme en la frontera API. |
| **IMPORTANTE** | [VERIFICADO EN REPOSITORIO] `createProduct.ts:69–105` realiza escrituras sucesivas, rollback compensatorio y omite errores de configuración Amazon opcional. | [INFERENCIA] “ok” no representa necesariamente el éxito de todas las suboperaciones; un agente necesita resultado parcial explícito. |
| **IMPORTANTE** | [VERIFICADO EN REPOSITORIO] Confirmación de orden, `route.ts:89–133`, puede confirmar y devolver advertencias por fallos secundarios. | [RECOMENDACIÓN] Modelar confirmación y tareas pendientes como estados distintos; no repetir todo indiscriminadamente. |
| **IMPORTANTE** | [VERIFICADO EN REPOSITORIO] Clientes de repositorio dependen de cookies; `routeClient.ts:3–10` ofrece contexto mediante `AsyncLocalStorage`. | [INFERENCIA] Reutilizarlos desde workers requiere contexto explícito; sustituirlo por admin indiscriminadamente alteraría permisos. |
| **IMPORTANTE** | [VERIFICADO EN REPOSITORIO] `CompetitiveAnnualPlannerPage.tsx:176–307` calcula estadísticas, precio objetivo y plan en UI; `DashboardBI.tsx:40–53,113–131` clasifica riesgos. | [RECOMENDACIÓN] Las reglas que deban compartir UI y tools necesitan un propietario determinista reutilizable. |
| **IMPORTANTE** | [VERIFICADO EN REPOSITORIO] Schemas manuales útiles conviven con casts de JSON, archivos schema vacíos y respuestas heterogéneas. | [RECOMENDACIÓN] Contrato de entrada/salida y errores de negocio por tool. No es obligatorio adoptar una librería concreta. |
| **IMPORTANTE** | [VERIFICADO EN REPOSITORIO] Auditoría específica en ejecuciones financieras, proformas y sync; logs dispersos. | [NO VERIFICADO] Audit trail transversal que una usuario → tarea → modelo → tool → aprobación → cambio. |
| **IMPORTANTE** | [VERIFICADO EN REPOSITORIO] Hay throttling/retries Amazon. | [NO VERIFICADO] Rate limiting general por usuario/tool, presupuestos de modelo y límites de concurrencia de IA. |
| **IMPORTANTE** | [VERIFICADO EN REPOSITORIO] Tests PGlite importan dependencias desde `.codex-work` o una variable de módulo; `package.json` no declara script `test`. | [INFERENCIA] La reproducibilidad desde un checkout limpio necesita consolidación. No significa ausencia de pruebas. |
| **IMPORTANTE** | [VERIFICADO EN REPOSITORIO] SQL histórico, propuestas y nuevas migraciones locales conviven; README advierte de solapamientos. | [NO VERIFICADO] Esquema realmente aplicado. Debe verificarse antes del piloto conectado a datos reales. |
| **MEJORA** | [VERIFICADO EN REPOSITORIO] Placeholders, archivos vacíos y directorios llamados `route.ts`. | [RECOMENDACIÓN] Inventario explícito de capacidades implementadas para evitar registrar tools inexistentes. |
| **MEJORA** | [VERIFICADO EN REPOSITORIO] `buildAmazonEconomicForecastV2Live` realiza llamadas externas desde una ruta GET. | [RECOMENDACIÓN] Documentar ese coste; separar consulta de snapshot y actualización cuando el caso lo requiera. |

[NO VERIFICADO] No afirmo que existan dependencias circulares, secretos comprometidos o vulnerabilidades explotadas. No encontré exposición evidente de service keys mediante variables `NEXT_PUBLIC_*` en los patrones revisados; esto no equivale a una auditoría completa del historial Git o de los bundles.

## 6. Qué debería ser workflow vs agente vs backend

[RECOMENDACIÓN]

| Categoría | Criterio | Ejemplos del proyecto |
|---|---|---|
| **A. Backend determinista** | Fórmula, validación o transición definida y verificable. | Herencia de productos, valoración FX, costes, disponibilidad, reglas de confirmación, movimientos financieros. |
| **B. Workflow determinista** | Secuencia conocida con esperas, estados, errores y retries. | Solicitar informe Amazon → consultar estado → validar → publicar; confirmar orden → completar tareas secundarias. |
| **C. Workflow + IA** | Pasos fijos donde uno necesita interpretar o redactar. | Consultar tesorería → calcular variaciones → redactar explicación → validar cifras → revisión. |
| **D. Agente con tools** | El camino de investigación cambia según la pregunta. | Investigar una caída de cobertura consultando ventas, stock, inbound y forecast, sin modificar datos. |
| **E. Multiagente** | Subproblemas independientes con competencias/contextos distintos y beneficio demostrado. | Análisis separado de viabilidad comercial y financiera de una compra, seguido de una síntesis controlada. Es un caso futuro, no existente. |
| **F. Humano** | Autoridad, responsabilidad o evidencia insuficiente para automatizar. | Aprobar un pago, aceptar condiciones comerciales excepcionales, decidir sobre datos contradictorios o autorizar una comunicación sensible. |

Antes de elegir D o E deberían poder responderse:

1. ¿La secuencia puede describirse por reglas? Si sí, empezar por A/B.
2. ¿La IA solo aporta interpretación o redacción? Preferir C.
3. ¿Necesita decidir dinámicamente qué información consultar? Considerar D.
4. ¿Varios agentes superan a uno con tools en calidad, coste y latencia medidos? Solo entonces E.
5. ¿Qué ocurre si el modelo se equivoca? Cuanto más irreversible sea el efecto, menor autonomía.
6. ¿Existe evidencia suficiente? La respuesta válida puede ser “no se puede determinar”.

**[RECOMENDACIÓN] Ni la disponibilidad de una API ni la existencia de un botón justifican permitir que un agente ejecute esa acción.**

## 7. Comparación de alternativas

[RECOMENDACIÓN] La comparación siguiente es una valoración para este ERP. Las propiedades externas consultadas no se presentan como implementaciones del repositorio.

Como base documental: LangGraph ofrece persistencia e interrupciones reanudables; n8n documenta revisión humana de llamadas a tools y gestión de entornos con Git; Temporal ofrece un motor de ejecución durable y SDK TypeScript. Ninguno aporta automáticamente los permisos de negocio del ERP. Fuentes: [persistencia LangGraph](https://docs.langchain.com/oss/javascript/langgraph/persistence), [interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts), [revisión humana n8n](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.gmail/message-operations/), [entornos n8n](https://docs.n8n.io/source-control-environments/create-environments/), [Temporal TypeScript](https://typescript.temporal.io/).

### Encaje, mantenimiento y control

| Aspecto | n8n principal | LangGraph | TypeScript propio + API de modelos | Híbrido | Temporal + TypeScript |
|---|---|---|---|---|---|
| Encaje actual | Obliga a crear APIs de capacidad y otro entorno operativo. | Encaja con TS, pero introduce runtime conceptual de grafos. | Mayor continuidad con servicios existentes. | ERP conserva núcleo; componentes externos se incorporan por necesidad. | Reutiliza TS; necesita workers e infraestructura adicional. |
| Complejidad inicial | Media; sube si absorbe reglas de negocio. | Media/alta para el primer caso sencillo. | Baja para una consulta acotada; alta si se inventa un motor durable. | Baja si empieza solo con ERP; alta si se instala todo a la vez. | Alta para un piloto informativo. |
| Mantenibilidad | Riesgo de lógica duplicada entre nodos y ERP. | Buena si los nodos llaman a servicios; peor si acumulan reglas. | Buena con límites; mala con un “agente universal” monolítico. | Buena si cada responsabilidad tiene un único propietario. | Buena para procesos largos; disciplina adicional de evolución/replay. |
| Versionado | Definiciones y despliegue separados del ERP. | Código versionado; también versiones de estado/checkpoints. | Git y contratos TS existentes. | Versiones coordinadas de API y orquestador. | Código e historial de workflows; compatibilidad de versiones relevante. |
| Testing | Pruebas de integración contra APIs del ERP. | Tests de nodos, transiciones y reanudación. | Reutilización directa de pruebas de dominio y contracts. | Tests de contrato entre fronteras. | Tests de workflows, actividades y recuperación. |
| Evals | Hay que crear dataset y criterios de negocio. | Ídem; evaluar rutas y uso de tools. | Ídem; más control, más trabajo propio. | Evaluación extremo a extremo independiente del motor. | No sustituye evals de los pasos con modelo. |
| Debugging/observabilidad | Vista de ejecuciones útil; necesita correlación con ERP. | Estado/checkpoints ayudan; integrar trazas y redacción. | Instrumentación explícita necesaria. | Más saltos; imprescindible un `runId` compartido. | Historial de ejecución útil; correlacionar con transacciones reales. |
| Lock-in | Definiciones, nodos y operación de la plataforma. | API de grafos y formato de estado. | Menor si el proveedor se encapsula; mantenimiento propio mayor. | Reduce dependencia del núcleo, no elimina integración. | Semántica durable y modelo operativo específico. |

[NO VERIFICADO] Coste y disponibilidad de funciones de n8n para el plan que utilizaríais. La documentación consultada sitúa la función de source control/environments en planes Business/Enterprise; debe validarse al contratar. [Fuente](https://docs.n8n.io/source-control-environments/create-environments/).

### Ejecución y seguridad

| Aspecto | n8n principal | LangGraph | TypeScript propio | Híbrido | Temporal |
|---|---|---|---|---|---|
| Workflows largos | Candidato para automatización; probar recuperación concreta. | Checkpoints e interrupciones con persistencia adecuada. | No resolver con una petición Next.js larga; necesita estado/worker. | Seleccionar un motor cuando aparezca el requisito. | Candidato fuerte si dominan procesos largos y recuperación. |
| Aprobación humana | Puede coordinarla; ERP valida quién y qué se aprobó. | Puede pausar; la autorización sigue siendo del ERP. | Hay que implementar estado durable de aprobación. | Aprobación de negocio centralizada en ERP. | Señal/reanudación; autorización sigue fuera del motor. |
| Idempotencia | Debe llegar a comandos/RPC del ERP. | Un checkpoint no hace idempotente un pago. | Reutilizar claves y fingerprints existentes. | Mismo contrato para todos los consumidores. | Actividades repetibles requieren idempotencia de negocio. |
| Retries | No permitir reintentos ciegos sobre `applyContainerStock`. | Mismo riesgo al reanudar nodos. | Clasificar error transitorio, negocio y resultado desconocido. | Un propietario de retry por operación. | Políticas de retry más motor; no “exactly once” del efecto externo. |
| Scheduler | Útil si concentra automatizaciones nuevas. | Requiere componente de programación. | Cron actual reutilizable para casos acotados. | Evitar programar el mismo sync en dos sitios. | Adecuado si la programación forma parte de workflows durables. |
| Eventos/webhooks | Buen candidato para conectores futuros. | Necesita entradas/API alrededor del grafo. | Endpoints y publicación durable propios. | n8n periférico puede recibir eventos y solicitar comandos. | Adapta eventos a ejecuciones/señales. |
| Permisos/seguridad | No entregar service role para operar tablas libremente. | No entregar herramientas genéricas SQL/HTTP. | Fácil proximidad a autorización ERP; exige disciplina. | ERP como frontera común obligatoria. | Worker con identidad y scopes, no privilegios ilimitados. |
| Escalabilidad | Evaluar arquitectura de despliegue y límites de conectores. | Evaluar workers, persistencia y concurrencia. | Separar ejecución larga del BFF. | Añade componentes solo cuando se midan límites. | Apropiado para workers durables; coste operacional mayor. |

### Agentes, equipo y participación de negocio

| Aspecto | n8n | LangGraph | TS propio | Híbrido | Temporal |
|---|---|---|---|---|---|
| Tools reutilizables | Mediante API autorizada ERP. | Mediante adaptadores a servicios. | Acceso directo controlado a servicios. | Un catálogo común, varios consumidores. | Actividades llaman al mismo catálogo/servicios. |
| Especialización | Flujos y agentes por caso, evitando duplicados. | Subgrafos/agentes cuando tengan función clara. | Perfiles de tools/prompts acotados. | Permite escoger según caso. | No es por sí mismo especialización inteligente. |
| Multiagente/comunicación | Posible composición; contratos y límites propios. | Candidato cuando exista coordinación con estado compleja. | Suficiente para coordinación sencilla y explícita. | No permitir redes de agentes con permisos transitivos. | Puede coordinar ejecuciones; la semántica de agentes es adicional. |
| Experiencia necesaria | Diseño de procesos, APIs y operación de n8n. | TS, grafos, estado y comportamiento de modelos. | TS/backend más modelos, seguridad y evals. | Equipo capaz de mantener fronteras entre sistemas. | Experiencia en sistemas distribuidos y operación. |
| Personas no técnicas | Mayor proximidad visual, con formación y gobernanza. | Participación mediante fichas/UI, no editando grafos de código. | Fichas y formularios del ERP. | Negocio define; n8n puede facilitar parte de la edición. | Participación mediante UI/fichas. |
| Lógica crítica dentro del ERP | Posible, pero debe imponerse como límite. | Posible si nodos no duplican reglas. | Encaje natural. | Es el principio central. | Actividades invocan servicios/RPC existentes. |

**[RECOMENDACIÓN] No elegiría n8n como núcleo principal en esta fase:** lo descubierto no demuestra todavía que los conectores entre aplicaciones y la edición visual sean el problema dominante.

**[RECOMENDACIÓN] Tampoco construiría un motor durable propio en TypeScript.** Una llamada acotada a modelo es una cosa; reproducir colas, recuperación, checkpoints y evolución de ejecuciones es otra inversión.

## 8. Arquitecturas candidatas

### Candidata A: ERP + capa de tareas TypeScript

[RECOMENDACIÓN] Apropiada si los primeros casos consultan información interna y terminan en segundos.

- Servicios actuales como fuente de verdad.
- Tools tipadas y autorizadas.
- Llamada al modelo encapsulada.
- Ejecuciones, límites y resultados trazables.
- Sin n8n ni LangGraph obligatorios.

**Trade-off:** menor complejidad inicial; las tareas largas exigirán añadir un ejecutor adecuado.

### Candidata B: ERP + n8n periférico

[RECOMENDACIÓN] Apropiada si las fichas revelan procesos entre correo, CRM, documentos, ERP y notificaciones.

- n8n recibe eventos o coordina conectores.
- ERP valida permisos y ejecuta negocio.
- n8n no replica cálculos financieros ni escribe tablas libremente.

**Trade-off:** mejor composición visual; más infraestructura, credenciales y coordinación de versiones.

### Candidata C: ERP + ejecución durable + LangGraph selectivo

[RECOMENDACIÓN] Apropiada si aparecen investigaciones agénticas reanudables o procesos que esperan horas/días y necesitan recuperación fiable.

- Motor durable para el proceso empresarial.
- LangGraph únicamente para subprocesos agénticos que lo justifiquen.
- Estado del motor separado del estado contable/operativo.

**Trade-off:** mayor robustez potencial y complejidad operativa. No está justificada como punto de partida por la evidencia actual.

**[RECOMENDACIÓN] Adoptaría A como base reversible y mantendría B/C como decisiones posteriores.** No es necesario decidir hoy el motor definitivo para fijar correctamente servicios, permisos y contratos.

## 9. Arquitectura propuesta

```text
Responsables de departamento
          |
          v
 Fichas de tareas y reglas aprobadas
          |
          v
 ERP UI existente + pantallas de tarea/resultado/aprobación
          |
          v
 Next.js API / BFF
 - autenticación
 - contexto confiable de usuario y organización
 - autorización por capacidad
 - validación de entrada
          |
          v
 Aplicación de tareas
 - elegir ejecución determinista, workflow o agente
 - runId, versión, presupuesto, plazo, cancelación
 - historial y resultados
          |
          +--------------------+----------------------+
          |                    |                      |
          v                    v                      v
 Servicio inmediato     Workflow durable       Agente acotado
 determinista           cuando sea necesario   con tools permitidas
                        TS/motor/n8n            SDK/model API
                                                LangGraph opcional
          |                    |                      |
          +--------------------+----------------------+
                               |
                               v
                     Frontera de capacidades
                     - schemas entrada/salida
                     - READ / WRITE / EXTERNAL
                     - scopes y minimización
                     - aprobación verificable
                     - idempotencia y límites
                               |
                               v
                  Servicios de dominio existentes
       products / inventory / orders / containers / finance
                    planner / suppliers / integrations
                               |
                   +-----------+-----------+
                   |                       |
                   v                       v
            Repositorios/RPC       Adaptadores de integración
            reglas y transacciones Amazon / Drive / BCE
                   |
                   v
             Supabase/PostgreSQL
             estado de negocio canónico

Transversal:
 - secretos servidor
 - logs/traces correlacionados y redactados
 - audit trail de decisiones y efectos
 - evaluaciones con fixtures y casos adversariales
 - scheduler y eventos con propietario único
```

Todo el diagrama futuro es **[RECOMENDACIÓN]**.

| Responsabilidad | Ubicación propuesta |
|---|---|
| UI y sesión | Next.js actual. |
| API pública del ERP | Route Handlers/BFF; no convertir cada tool interna automáticamente en endpoint público. |
| Reglas críticas | Servicios de dominio y RPC transaccionales existentes. |
| Tools | Adaptadores pequeños sobre casos de uso autorizados; no sobre tablas arbitrarias. |
| Workflows | Capa de aplicación; ejecución durable fuera de una petición HTTP cuando sea necesario. |
| Agentes | Runtime separado conceptualmente del dominio, inicialmente en TS. |
| Multiagente | Coordinador explícito con contratos de entrada/salida; solo tras demostrar necesidad. |
| Prompts/modelos | Versionados junto a la capacidad; adaptador de proveedor y configuración servidor. |
| Memoria | Estado de ejecución; conversación solo si el caso la requiere. Nunca sustituye los datos actuales del ERP. |
| RAG | Componente opcional para documentos/procedimientos, con ACL y procedencia. No necesario para consultar tablas mediante tools. |
| Permisos/aprobaciones | ERP; exigibles también cuando llama n8n, un worker o un agente. |
| Secretos | Gestor de secretos del entorno de despliegue; referencias, no valores, en tareas/prompts. |
| Scheduler/eventos | Un propietario por proceso; reutilizar cron específico sin duplicar sync. |
| Logs/tracing/audit | Correlación común, almacenamiento y retención según sensibilidad. |
| Evaluaciones | Repositorio de casos, fixtures y métricas por capacidad. |
| Base de datos | Supabase como fuente de verdad empresarial; estado técnico de ejecución separado lógicamente. |

## 10. Modelo de agentes/tools/workflows

[RECOMENDACIÓN]

| Concepto | Límite |
|---|---|
| **SERVICE** | Implementa una capacidad de negocio determinista. |
| **TOOL** | Expone un contrato acotado, autorizado y observable a un consumidor automático. |
| **WORKFLOW** | Define pasos, transiciones, espera, compensación y resultado. |
| **AGENT** | Decide qué tools permitidas necesita para resolver una tarea dentro de un presupuesto. |
| **JOB** | Unidad ejecutable con scheduling, claim, timeout y resultado; puede ejecutar servicio o workflow. |
| **HUMAN APPROVAL** | Decisión de una persona autorizada sobre una acción concreta y sus consecuencias. |

### Organización recomendada

- **Departamentos:** definen objetivos, visibilidad y autoridad.
- **Capacidades:** consultar tesorería, analizar cobertura, revisar costes.
- **Agentes:** perfiles especializados solo cuando cambie sustancialmente el razonamiento o el conjunto de tools.
- **Router inicial:** clasifica el caso de uso y aplica políticas; no necesita ser otro LLM.
- **Workflows:** independientes cuando el proceso esté definido.
- **Supervisor:** añadirlo solo si hay delegación real que coordinar.

[RECOMENDACIÓN] Un responsable de compras y otro de dirección pueden utilizar la misma tool de forecast con distinto alcance. No necesitan dos implementaciones del cálculo.

[VERIFICADO EN REPOSITORIO] El proyecto ya contiene invariantes delicados: estados financieros, identidad Amazon, pools, costes por moneda e idempotencia.

[RECOMENDACIÓN] Esos invariantes deben permanecer deterministas. El agente puede explicar por qué un producto requiere revisión; no redefinir qué significa stock disponible, qué settlement representa dinero recibido o cómo se contabiliza una amortización.

La comunicación entre agentes, si llega a existir, debería transportar **resultados estructurados, referencias, incertidumbres y `runId`**, no instrucciones que otorguen nuevos permisos.

## 11. Seguridad y permisos

### Modelo de autorización

[RECOMENDACIÓN]

```text
Actor autenticado
 + organización/contexto autorizado
 + capacidad solicitada
 + perfil de agente/workflow
 + tool y versión
 + scopes de recursos/campos/acciones
 + política de aprobación
 + límites de ejecución
 = autorización evaluada en servidor
```

**Permisos efectivos = intersección de los permisos del usuario, del proceso y de la tool.** El agente no puede ampliar esa intersección mediante lenguaje natural.

| Perfil propuesto | Tools | Scopes | Aprobación |
|---|---|---|---|
| Analista de catálogo | Catálogo/ficha mínima. | Productos autorizados; sin costes si no corresponde. | No para consultas permitidas. |
| Analista operativo | Stock, ventas en unidades, inbound, forecast. | Países/canales/productos autorizados. | No para consulta; sí para cambios derivados. |
| Analista financiero | Planificación y detalles según rol. | Cuentas/periodos/campos permitidos. | Sin escrituras en el piloto. |
| Preparador de compra | Consulta y propuesta de borrador. | Proveedores/productos autorizados, límites de importe. | Confirmación comercial separada. |
| Ejecutor financiero | Comandos específicos, nunca SQL genérico. | Cuenta, importe, obligación y acción exacta. | Obligatoria según política; doble control si se exige. |

Son perfiles candidatos, no roles existentes.

### Controles específicos

[RECOMENDACIÓN]

- **Identidad:** derivar usuario y organización del contexto autenticado; no de `body.userId`.
- **RLS:** comprobar políticas y grants efectivos; revisar también vistas y RPC `SECURITY DEFINER`.
- **Service role:** reservarlo para jobs o accesos expresamente autorizados; nunca introducirlo en prompts ni concederlo al orquestador como acceso universal.
- **Aprobación:** guardar actor, acción, parámetros normalizados, fingerprint, versión del recurso, caducidad y decisión.
- **Revalidación:** al ejecutar, comprobar permisos actuales y que el recurso no cambió desde la aprobación.
- **Resultado desconocido:** si un proveedor pudo ejecutar antes de un timeout, reconciliar antes de reintentar.
- **Prompt injection:** mensajes, documentos, nombres de producto, CSV y respuestas externas son datos no confiables. No pueden modificar política, tools disponibles ni destinos de envío.
- **Indirect prompt injection:** recuperar un documento no autoriza seguir sus instrucciones. Separar contenido recuperado del contrato de ejecución.
- **Exfiltración:** sin tool HTTP, SQL, shell o envío genérico; destinos externos predefinidos y salidas mínimas.
- **Escrituras:** preview y diff antes de aprobación; ejecución determinista posterior.
- **Borrados:** prohibidos por defecto para agentes; habilitación puntual por recurso y política.
- **Compras, pagos y finanzas:** no inferir consentimiento de una conversación ambigua ni de una recomendación.
- **Campañas/comunicaciones:** no disponibles actualmente como capacidad demostrada; exigir contratos y políticas antes de añadirlas.
- **Auditabilidad:** conservar argumentos efectivos, identidad, aprobación y efecto; no hace falta almacenar razonamiento interno del modelo.
- **Retención:** limitar prompts, documentos y resultados sensibles en logs/checkpoints.

[VERIFICADO EN REPOSITORIO] El documento de guardrails Amazon exige revisar el envío de información Amazon a proveedores de IA y preservar procedencia/frescura.

[NO VERIFICADO] Permisos contractuales actuales de ese tratamiento, región de los proveedores y retención. La existencia del documento no demuestra cumplimiento ni sustituye esa revisión.

## 12. Plantilla para recoger tareas de los departamentos

[RECOMENDACIÓN] Ficha lista para entregar:

### Ficha de tarea empresarial

| Campo | Qué debe escribir el responsable |
|---|---|
| Nombre | Un nombre reconocible: “Revisar pagos de la próxima semana”. |
| Responsable | Departamento y persona que valida el resultado. |
| Objetivo | Qué problema resuelve y cómo se hace hoy. |
| Inicio | Qué la activa: petición, fecha, cambio de estado, documento o evento. |
| Información necesaria | Qué datos necesita y con qué antigüedad máxima. |
| Sistemas consultados | ERP, Amazon, banco, Drive, correo, hojas de cálculo, otros. |
| Alcance | Empresa, países, canales, productos, proveedores, cuentas o periodos. |
| Pasos actuales | Qué hace una persona, en orden. |
| Decisiones | Qué decisiones tienen reglas claras y cuáles necesitan criterio. |
| Acciones posibles | Consultar, proponer, crear borrador, modificar, enviar, confirmar, borrar. |
| Resultado esperado | Informe, lista priorizada, propuesta, documento o cambio concreto. |
| Frecuencia y volumen | Cuántas veces y cuántos registros/documentos. |
| Tiempo disponible | Cuándo debe terminar y cuánto puede esperar. |
| Excepciones | Datos faltantes, contradicciones, proveedor caído, duplicados. |
| Quién puede ejecutarla | Perfiles o personas autorizadas. |
| Quién puede ver el resultado | Puede ser distinto de quien la ejecuta. |
| Aprobaciones | Qué acción, quién aprueba, importe/límite y caducidad. |
| Prohibiciones | Qué nunca puede hacer automáticamente. |
| Criticidad | Baja/media/alta/crítica, explicando por qué. |
| Error y consecuencias | Qué pasaría si usa datos incorrectos o ejecuta dos veces. |
| Recuperación | Cómo se detecta, detiene y corrige un error. |
| Ejemplos | Un caso normal, uno excepcional y uno que debe rechazarse. |
| Criterio de éxito | Evidencia concreta para aceptar la solución. |

### Conversión de ficha a implementación

[RECOMENDACIÓN]

1. **Tarea de negocio:** aclarar resultado y responsabilidad.
2. **Caso de uso:** definir actor, alcance, precondiciones y criterios de aceptación.
3. **Clasificación A–F:** decidir backend, workflow, IA o intervención humana.
4. **Tools:** mapear cada paso a capacidades existentes o faltantes.
5. **Backend:** añadir únicamente contratos, permisos o lógica que el caso requiera.
6. **UI:** diseñar entrada, resultado, excepción y aprobación de esa tarea.
7. **Evaluación:** convertir los ejemplos del responsable en pruebas y evals.
8. **Piloto:** medir utilidad, errores, coste y necesidad real de autonomía.

No se debe traducir “departamento marketing” directamente a “crear agente Marketing”.

## 13. Impacto futuro en backend

| Componente | Estado | Justificación |
|---|---|---|
| Servicios de negocio | **YA EXISTE**, parcialmente. [VERIFICADO EN REPOSITORIO] | Base de productos, inventario, compras, finanzas y Amazon. |
| Autenticación | **YA EXISTE**. [VERIFICADO EN REPOSITORIO] | Supabase Auth y clientes SSR. |
| Autorización por capacidad | **REUTILIZABLE CON CAMBIOS**. [RECOMENDACIÓN] | Extender el patrón financiero; no depender solo de departamento. |
| Catálogo de tools | **FALTA funcionalmente**. [VERIFICADO EN REPOSITORIO] | `toolRegistry.ts` vacío. Puede empezar en código; no necesita una tabla propia. |
| Catálogo de workflows/agentes | **NO SABEMOS SI REQUIERE REGISTRO DINÁMICO**. [RECOMENDACIÓN] | Inicialmente definiciones versionadas en código bastan. |
| Ejecución e historial de tareas | **FALTA transversalmente**. [NO VERIFICADO] | Necesario para conocer quién pidió qué, estado y resultado. Reutilizar patrones de runs, no mezclar tablas Amazon con tareas genéricas. |
| Estados/reanudación | **REUTILIZABLE CON CAMBIOS**. [RECOMENDACIÓN] | Hay estados de sync; falta contrato general y decidir motor. |
| Aprobaciones | **FALTA** como capacidad durable demostrada. [NO VERIFICADO] | Necesaria antes de writes agénticos sensibles. |
| Idempotencia | **REUTILIZABLE CON CAMBIOS**. [VERIFICADO EN REPOSITORIO] | Ya existe en RPC financieras; no es homogénea. |
| Scheduler | **YA EXISTE para procesos concretos**. [VERIFICADO EN REPOSITORIO] | Cron Amazon. Generalizar solo cuando haya tareas programadas nuevas. |
| Eventos/outbox | **NO ENCONTRADO**. [NO VERIFICADO] | Introducir publicación durable si un cambio de negocio debe desencadenar otra tarea sin pérdidas. |
| Conversaciones | **NO SABEMOS TODAVÍA SI SON NECESARIAS**. [RECOMENDACIÓN] | Una tarea con formulario y resultado no necesita chat persistente. |
| Artefactos/resultados | **REUTILIZABLE CON CAMBIOS**. [RECOMENDACIÓN] | Drive/Storage existen; requieren ACL y relación con ejecución. |
| Prompts/modelos/evals | **FALTA runtime funcional**. [VERIFICADO EN REPOSITORIO] | Añadir por caso y versión. |
| RAG/vector store | **NO SABEMOS SI ES NECESARIO**. [RECOMENDACIÓN] | Solo si aparecen documentos cuya recuperación semántica aporte valor. |
| Auditoría y tracing | **REUTILIZABLE CON CAMBIOS**. [RECOMENDACIÓN] | Unificar correlación sobre rastros específicos existentes. |
| Gestión de credenciales | **REUTILIZABLE CON CAMBIOS**. [RECOMENDACIÓN] | Hay variables y adaptadores. Una UI de credenciales solo se justifica si habrá conexiones configurables por usuarios/empresas. |

[RECOMENDACIÓN] Antes de proponer tablas debe decidirse qué estado posee el ERP y cuál posee el motor. Duplicar checkpoints, ejecuciones y estados de negocio en dos sistemas crearía reconciliación innecesaria.

## 14. Impacto futuro en UI

[VERIFICADO EN REPOSITORIO] Se pueden reutilizar `DashboardShell`, filtros globales, tablas, modales, estados de error/carga y pantallas de producto, inventario y planificación.

[RECOMENDACIÓN] Para el primer caso probablemente basten:

- Entrada acotada desde la pantalla del dominio.
- Resultado con fuentes, fecha, filtros, hipótesis y limitaciones.
- Estado de ejecución y error comprensible.
- Acción para abrir el registro original.
- Feedback sobre utilidad/corrección.

Antes de escrituras harían falta:

- Vista de propuesta con cambios exactos.
- Aprobación/rechazo por persona autorizada.
- Caducidad y aviso de datos modificados.
- Historial de ejecución y resultado parcial.
- Reconciliación cuando el efecto sea desconocido.

[NO VERIFICADO] Necesidad de chat global, voz, constructor visual, marketplace de agentes o panel multiagente. Depende de las fichas; los placeholders actuales no justifican construir esas interfaces.

[RECOMENDACIÓN] Los estados deben distinguir “propuesta preparada”, “aprobada”, “ejecutada” y “falló/parcial”. Una respuesta convincente del modelo no debe parecer una operación completada.

## 15. Estrategia incremental

Todas las etapas siguientes son **[RECOMENDACIÓN]**.

| Etapa | Objetivo/componentes | Dependencias y riesgos | Criterio de cierre |
|---|---|---|---|
| **0. Contrato y límites** | Elegir una ficha; mapear servicios, permisos, datos y efectos; resolver frontera insegura de IA para ese recorrido. | Esquema desplegado, alcance empresarial y política de proveedor. | Contrato revisado con ejemplos positivos, negativos y datos incompletos; ningún permiso implícito. |
| **1. Primera capacidad read-only** | Tool sobre datos persistidos; salida estructurada y resumen opcional con modelo. | Calidad/frescura y autorización. | No puede escribir; pruebas de acceso; cifras rastreables; reconoce información insuficiente. |
| **2. Primer workflow** | Secuencia fija, por ejemplo consulta → cálculo → resumen → resultado guardado. | Definir scheduling, idempotencia y recuperación solo si aplica. | Repetir o fallar no duplica efectos; cada paso y versión identificables. |
| **3. Primer agente con tools** | Investigación variable con pocas tools READ, presupuesto y límite de pasos. | Dataset que demuestre utilidad sobre el workflow fijo. | Mejora medible; selección correcta de tools; resistencia a instrucciones maliciosas; no inventa resultados. |
| **4. Primera acción aprobada** | Empezar por una escritura reversible y de bajo impacto; propuesta, approval y comando. | Autorización, idempotencia, concurrencia, recuperación. | Payload aprobado coincide con ejecutado; doble ejecución y aprobación caducada se rechazan/controlan. |
| **5. Segundo dominio** | Reutilizar ejecución, permisos y contratos. | Evitar hardcodes del piloto y contaminación entre contextos. | Segundo caso integrado sin duplicar infraestructura ni reglas críticas. |
| **6. Orquestación avanzada** | Adoptar n8n, motor durable o LangGraph donde un requisito real lo justifique. | Coste operativo, versionado y persistencia. | Pruebas de reinicio, espera, retry, cancelación y evolución de versión. |
| **7. Multiagente condicionado** | Dividir un caso con tareas independientes y coordinador explícito. | Coste, latencia, contradicciones y propagación de permisos. | Supera una solución más simple en métricas acordadas, sin ampliar autoridad. |

No comenzaría las acciones aprobadas por pagos, borrados o aplicación de stock.

## 16. Candidatos para primer piloto

No los ordeno: cada uno valida una necesidad distinta.

### A. Revisión explicada de planificación de tesorería

**Pregunta:** “¿Qué compromisos y disponibilidades requieren revisión en los próximos meses?”

- [VERIFICADO EN REPOSITORIO] `buildFinancialPlanning`, ruta `/api/finance/planning`, controles de rol, frescura Amazon y componentes de planificación.
- [VERIFICADO EN REPOSITORIO] Hay datos/modelos para pagos, obligaciones, crédito e ingresos Amazon.
- [RECOMENDACIÓN] Tools: leer planificación, explicar componentes permitidos y señalar información incompleta.
- [INFERENCIA] Puede aportar valor sin dar autonomía financiera.
- **Riesgos:** confundir previsto con disponible/recibido, omitir importes sin FX o tratar datos antiguos como actuales.
- **Falta:** validar esquema y cobertura actuales; salida resumida por rol; evals de cifras y estados.
- [RECOMENDACIÓN] Consultar el read model persistido; no usar automáticamente el forecast V2 live como si fuera lectura local.

### B. Revisión de catálogo, costes y documentación de productos

**Pregunta:** “¿Qué información falta o es inconsistente antes de revisar este producto?”

- [VERIFICADO EN REPOSITORIO] Catálogo, ficha compuesta, herencia, costes, proveedores, documentos y selección de competidores.
- [RECOMENDACIÓN] Tools: catálogo, ficha mínima y comprobaciones deterministas de completitud.
- [INFERENCIA] Buen caso para probar autorización por campos y explicaciones basadas en evidencia.
- **Riesgos:** exponer costes/contactos; interpretar costes de distinta moneda; recuperar documentos con permisos inadecuados.
- **Falta:** definir qué significa “completo” por categoría y tarea; revisar acceso a documentos.
- [RECOMENDACIÓN] El piloto puede operar solo con metadata y campos estructurados, sin RAG ni descarga de documentos.

### C. Investigación de cobertura y riesgo de reposición

**Pregunta:** “¿Por qué este producto aparece con riesgo y qué datos debo revisar?”

- [VERIFICADO EN REPOSITORIO] Comparativa de inventario, snapshots canónicos, ventas, forecast y `analyzeProducts`.
- [RECOMENDACIÓN] Tools: stock persistido, ventas en unidades, inbound y forecast.
- [INFERENCIA] Permite comparar un workflow fijo con un agente que elige consultas.
- **Riesgos:** confundir pool con marketplace/ubicación física, cero con falta de datos, o identidad no resuelta con producto conocido.
- **Falta:** unificar scope de consultas, contratos de frescura/completitud y explicaciones contrastables.
- [RECOMENDACIÓN] Excluir crear/confirmar órdenes y aplicar stock.

[RECOMENDACIÓN] Marketing no es todavía un piloto equivalente en infraestructura demostrada: hay piezas de datos, pero no un módulo operativo de campañas. Eso puede cambiar si el responsable plantea una tarea de análisis documental o estructurado que no dependa de esa integración.

## 17. Preguntas abiertas

Todo lo siguiente permanece **[NO VERIFICADO]**:

1. ¿El sistema será para una sola empresa o para varias entidades con aislamiento?
2. ¿Qué migraciones, grants y políticas RLS están aplicadas realmente?
3. ¿Qué versión del checkout está desplegada y qué cambios locales se aceptarán?
4. ¿Qué volumen, frescura y cobertura tienen los datos de cada candidato?
5. ¿Dónde se ejecutará el ERP y qué infraestructura puede alojar workers?
6. ¿Qué tareas concretas necesitan esperar horas/días o recibir eventos externos?
7. ¿Qué capacidad tiene el equipo para operar n8n, LangGraph o un motor durable?
8. ¿Qué personas pueden consultar costes, tesorería, contactos y documentos?
9. ¿Qué acciones requieren doble aprobación o separación entre solicitante y aprobador?
10. ¿Qué proveedores de modelos, regiones y retenciones son aceptables?
11. ¿Puede enviarse cada categoría de datos Amazon/financieros/documentales al proveedor elegido?
12. ¿Qué documentos de Drive tienen actualmente acceso público y cuáles deberían tenerlo?
13. ¿Hay CRM, sistema contable, banco, herramientas de marketing o automatizaciones externas no representadas en este repositorio?
14. ¿Qué tests se ejecutan regularmente y con qué entorno reproducible?
15. ¿Qué tiempo, coste y tasa de error se consideran aceptables por tarea?
16. ¿Necesitan los responsables editar procesos o únicamente definirlos y solicitar cambios?
17. ¿Qué valor adicional tendría un agente frente a una consulta o workflow para cada ficha?

## 18. Archivos inspeccionados

Rutas relativas a `C:\Users\Jennifer\Desktop\bussines + erp\ERP_BI_IA`. Los rangos anteriores son aproximados y corresponden al checkout observado.

| Área | Evidencia principal |
|---|---|
| Stack | `package.json`, `package-lock.json`, `next.config.js`, `vercel.json`, `.gitignore`. |
| Arquitectura UI | `app/[locale]/(dashboard)/layout.tsx`, `shared/layout/DashboardShell.tsx`, `modules/dashboard/components/DashboardBI.tsx`, `modules/competitive-planning/components/CompetitiveAnnualPlannerPage.tsx`. |
| Auth | [middleware.ts](</C:/Users/Jennifer/Desktop/bussines + erp/ERP_BI_IA/middleware.ts:75>), `server/auth/adminAuthorization.ts`, `requireFinanceAccess.ts`, `requireUser.ts`, `requireAdmin.ts`. |
| Supabase | `server/supabase/adminClient.ts`, `client.ts`, `routeClient.ts`, `serverClient.ts`, `server/db/transaction.ts`, archivos de tipos. |
| IA | [app/api/ai/chat/route.ts](</C:/Users/Jennifer/Desktop/bussines + erp/ERP_BI_IA/app/api/ai/chat/route.ts:6>), [businessAgent.ts](</C:/Users/Jennifer/Desktop/bussines + erp/ERP_BI_IA/modules/ai/agent/businessAgent.ts:6>), inventario completo de `modules/ai`. |
| Productos | `getProductCatalog.ts`, `getProductDetail.ts`, `createProduct.ts`, `productCatalogRepository.ts`, `productCoreRepository.ts`, `productSalesRepository.ts`, `productProfitabilityRepository.ts`, `productCatalogQuerySchema.ts`. |
| Competidores | `getProductBenchmarkCompetitors.ts`, `saveProductBenchmarkSelection.ts`; rutas `products/[id]/benchmarking/*`. |
| Inventario/planner | `amazonCanonicalInventoryReadModel.ts`, `analyzeProducts.ts`, `plannerRepository.ts`; rutas `inventory/comparison`, `inventory/amazon-canonical`, `inventory/product/[id]/forecast`, `planning/analyze`. |
| Compras | `ordersRepository.ts`, `orderConfirmRepository.ts`; rutas `orders/create-from-planner`, `orders/[id]/confirm`. |
| Stock | [applyContainerStock.ts](</C:/Users/Jennifer/Desktop/bussines + erp/ERP_BI_IA/modules/containers/services/applyContainerStock.ts:131>), `containerStockRepository.ts`, `containerBillingRepository.ts`. |
| Finanzas | `buildFinancialPlanning.ts`, `financialPlanningRepository.ts`, `amazonFinancialPlanningSync.ts`, `supplierPaymentExecutionService.ts`, `buildAmazonEconomicForecastV2.ts`, `ecbFxService.ts`; rutas de planning, refresh, mark-paid y receive. |
| Amazon | `amazonReportSchedulerService.ts`, `amazonReportSchedulerRepository.ts`, `spApiClient.ts`, `lwaClient.ts`, `config.ts`; rutas cron y búsquedas en servicios de identidad, snapshots, telemetría y errores. |
| Documentos | [googleDriveService.ts](</C:/Users/Jennifer/Desktop/bussines + erp/ERP_BI_IA/modules/drive/googleDriveService.ts:174>), rutas específicas de documentos y `/api/drive` legacy. |
| SQL | `sql/README.md`, `sql/migrations/README.md`, `finance_supplier_payments_rls.sql`, `contenedor_ordenes_rls_policies.sql`, `amazon_ads_bi.sql`, migraciones de autorización financiera, idempotencia, flujo operativo, proformas y snapshots FBA/FBM/tesorería. |
| Tests | `amazonObservationRun.test.mjs`, `scripts/test-recurring-payments-db.mjs`, búsquedas de pruebas de concurrencia/autorización y contratos. Inspeccionados, no ejecutados. |
| Guías | `.agents/AGENTS.md`, `prompts/documentacion.txt`, `prompts/anti_duplicados.txt`, `docs/architecture/AMAZON_SP_API_SECURITY_DESIGN_GUARDRAILS.md`. |

**[RECOMENDACIÓN] La siguiente decisión debería ser elegir una ficha de piloto y cerrar su contrato de datos, permisos y resultado. La elección del orquestador puede esperar hasta conocer qué necesita ejecutar realmente esa tarea.**

<oai-mem-citation>
<citation_entries>
MEMORY.md:1-14|note=[orientacion inicial sobre cambios locales de tesoreria contrastados con el checkout]
</citation_entries>
<rollout_ids>
01a0a507-b9da-7573-87ef-b019acfef76c
</rollout_ids>
</oai-mem-citation>