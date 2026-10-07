# Pipeline can?nico All Orders ? fase 1 local

Fecha: 2026-10-07. Lectura final: 2026-10-07T10:41:53.377Z.

## 1. Checkpoint Git

[VERIFICADO EN C?DIGO] Rama feature/finance-forecast, HEAD b81890ca. Inicialmente 62 archivos tracked modificados/eliminados, numerosos untracked y ning?n staged. Hab?a trabajo anterior de All Orders, FBA/FBM, Finance, inventario, planner, productos y pedidos.

Se conservaron los cambios ajenos: comparaci?n de 61 patches tracked ajenos contra el checkpoint, cero diferencias. No reset, clean, restore, checkout, commit ni staging. Los dos owners de identidad se ampliaron; el keyset reader previo permanece. El importer, parser, migration inicial y rutas All Orders ya eran untracked antes de esta tarea. No deben confundirse con archivos reci?n creados.

Evidencia: ../../outputs/amazon-orders-phase1/checkpoint-status.txt, checkpoint-existing.diff y unrelated-work-preservation.json.

## 2. EAN maestros corregidos

[VERIFICADO EN BD] Se consultaron productos y producto_logistica en READ ONLY, sin usar env?os como condici?n previa. Los cinco EAN son distintos, coinciden con el SKU y pasan checksum EAN-13 [VERIFICADO EN TEST: c?lculo local]. Esto confirma consistencia del maestro; la correspondencia f?sica con una etiqueta comercial no se verific? [NO VERIFICABLE].

| Producto | SKU | EAN maestro | ASIN |
|---|---|---|---|
| BUBBLY - GRIS | 8436616610340 | 8436616610340 | B0GLQX4PN4 |
| BUBBLY - VERDE | 8436616610364 | 8436616610364 | B0GLQKQJWY |
| SAMI - GRIS | 8436616610135 | 8436616610135 | B0DNZG9X29 |
| SAMI - MENTA | 8436616610128 | 8436616610128 | B0DNZD6BHS |
| SAMI - ROSA | 8436616610326 | 8436616610326 | B0FQ5Y2WHW |

SAMI-MENTA ya no comparte 0326 con SAMI-ROSA. La condici?n previa est? superada. Permanecen 7 EAN compartidos entre otros productos: 8436616610043 (2 productos); 8436616610173 (2 productos); 8436616610241 (3 productos); 8436616610302 (3 productos); 8436616610654 (2 productos); 8436616610739 (2 productos); dddddddddddddddd (3 productos). No se corrigieron.

[VERIFICADO EN BD] Se registran 9 asociaciones hist?ricas de amazon_envios como HISTORICAL_IDENTITY_MAPPING_SUSPECT, con UUID y matched_by en el JSON de evidencia. Ejemplos: f8436616610364 ? BUBBLY-GRIS y f8436616610326 ? SAMI-GRIS, ASIN vac?o, matching por producto_logistica.ean_upc_normalizado. Permanecen intactas. No constituyen autoridad de ventas ni bloqueo del maestro actual.

## 3. Arquitectura antes

[VERIFICADO EN C?DIGO] All Orders solicitaba ventanas de hasta 30 d?as, con margen UTC adicional; ese margen pod?a superar 30 d?as efectivos. Depend?a de polling dentro de la petici?n. Su POST pod?a ignorar el rango recibido y continuar un job abierto de menos de 24 h. El cron combinaba creaci?n y recovery. CANCELLED se trataba como importaci?n vac?a completa. El parser usaba Madrid salvo GB, asignaba cualquier canal inesperado a FBM y sumaba duplicados sin comprobar coherencia de estados/canal.

El matcher compartido de inventario hac?a fallback amplio por limpieza, d?gitos y EAN. Su rama de alias pod?a volver antes de comprobar conflicto global del ASIN. El loader operacional exclu?a productos no activos y pod?a filtrar conflictos antes de que el resolver los viera.

## 4. Cambios implementados localmente

[VERIFICADO EN C?DIGO] Se conserva allOrdersSalesSyncService como owner del pipeline. Se separan pol?tica pura, coordinador, repositorio, gate del documento y HTTP. Se mantiene GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL, nunca Fulfilled Shipments. El owner existente amazonInventoryIdentityResolver incorpora la resoluci?n estricta de ventas; no se reemplaz? ni relaj? la pol?tica operacional que consumen inventarios.

Se a?ade lease con token/expiraci?n, singleton de operaci?n activa, manifiesto temporal inmutable y transacci?n de importaci?n/cobertura. Los jobs FBA, FBM y All Orders legacy no intervienen en el claim dedicado. Los jobs legacy existentes no se convierten ni se reabren; un jobId legacy devuelve error expl?cito. El flag AMAZON_ORDERS_CANONICAL_ENABLED est? ausente y el pipeline queda deshabilitado por defecto. No se edit? .env.local ni vercel.json.

## 5. Resolver can?nico resultante

[REGLA DE NEGOCIO] Un ASIN no representa leg?timamente dos productos ERP.

[VERIFICADO EN C?DIGO] Fuentes: productos.sku exacto; productos.asin v?lido; relaciones producto/ASIN y aliases persistidos del Ledger. Incluye productos descatalogados si a?n existen en ERP y no oculta candidatos contradictorios. producto_logistica.ean_upc se carga solo como diagn?stico. amazon_envios no se consulta por el resolver. Tampoco se escribe ning?n alias nuevo.

- ASIN ?nico + SKU mismo producto/desconocido: SAFE_BY_ASIN.
- ASIN con varios productos, o ASIN ?nico + SKU/alias de otro producto: IDENTITY_CONFLICT; producto_id null.
- ASIN desconocido/vac?o + SKU exacto ?nico: SAFE_BY_SKU_EXACT.
- ASIN desconocido/vac?o + alias Ledger ?nico: SAFE_BY_ALIAS.
- SKU/alias con varios productos: IDENTITY_AMBIGUOUS; producto_id null.
- Extracci?n Twinly/EAN oficial: diagn?stico; varios candidatos ? IDENTITY_AMBIGUOUS; uno o ninguno ? UNRESOLVED. No asigna por parecido, prefijos, eliminaci?n de letras o separadores.

Se construyen todos los candidatos deterministas antes de decidir. identity_resolution JSON guarda resultado, evidencia y versi?n sales-v1. La resoluci?n estricta se aplica ?nicamente a ventas; el comportamiento legacy de inventario queda preservado para evitar cambios ajenos de FBA/FBM.

## 6. Generaci?n y recovery

[VERIFICADO EN C?DIGO] Generaci?n: POST /api/cron/amazon/orders-sync/generate. Recovery: POST /api/cron/amazon/orders-sync/recover. Compatibilidad /orders-sync ahora es recovery-only. Ambas acciones requieren CRON_SECRET; ninguna se ha invocado. No se usa /api/cron/amazon/reports/run y no se modifica su c?digo.

El POST de UI /api/amazon/reports/all-orders/import conserva su autenticaci?n. fromDate/toDate generan o reanudan exclusivamente el mismo rango/scope; otro rango activo devuelve 409 ALL_ORDERS_RANGE_CONFLICT. jobId es recovery expl?cito; no se acepta mezclarlo con fechas.

Un tick avanza CREATE, POLL o IMPORT; no duerme ni hace bucles internos. Recovery no crea una operaci?n nueva, aunque puede crear el report de un chunk ya planificado dentro de una operaci?n existente. Un intent CREATE se persiste antes de llamar a Amazon; un resultado incierto bloquea recreaci?n autom?tica. El polling respeta nextAttemptAt. 429 y errores temporales en POLL/IMPORT usan backoff 60 s?15 min, Retry-After y hasta 8 reintentos; errores definitivos quedan FAILED. El lease es de 3 minutos y los RPC tienen timeout local de 15 s. El transporte tiene abort de 45 s y descarga limitada a 32 MiB. No hay worker/cron activado.

## 7. Cobertura y watermark

[VERIFICADO EN C?DIGO] amazon_orders_coverage guarda marketplace_id, start_date, end_date, status, report_id, report_document_id, completed_at, data_start_time, data_end_time y rows_committed por job/ventana. No deriva cobertura de la existencia de pedidos. Los datos hist?ricos sin esta evidencia seguir?n MISSING hasta una futura operaci?n autorizada; no hay backfill.

GET /api/cron/amazon/orders-sync/coverage-status?marketplaceId=...&fromDate=...&toDate=... devuelve evidencia e informaci?n por d?a: COMPLETE, PARTIAL, MISSING, IN_PROGRESS o FAILED. COMPLETE previo no se invalida por un intento posterior fallido. Un hueco intermedio produce PARTIAL y el d?a ausente queda MISSING.

La importaci?n y la evidencia de cobertura se confirman at?micamente. DONE con documento v?lido y cabeceras, incluso cero filas, puede certificar intervalo cerrado. CANCELLED/FATAL no certifican un d?a vac?o. El d?a actual se separa y queda PARTIAL con un l?mite UTC congelado al solicitar la operaci?n. COMPLETED del job significa que termin? el trabajo solicitado, no que el d?a parcial est? cerrado. Si falla una operaci?n, sus ventanas pendientes pasan a cobertura FAILED; las completas permanecen.

## 8. Reimportaci?n de 14 d?as

[VERIFICADO EN C?DIGO] AMAZON_ORDERS_REIMPORT_DAYS centraliza la ventana; default 14, configurable entre 1 y 366. Incluye el d?a actual como parcial y los anteriores cerrados. La planificaci?n usa una fecha de referencia Europe/London; cada marketplace convierte sus l?mites locales y valida que no se soliciten d?as futuros. La generaci?n deja visible el rango real en la respuesta y cada report/rango en sus ventanas. Una operaci?n abierta de otro rango exige recovery antes de generar otra, mediante conflicto expl?cito; nunca se ignora el rango pedido.

## 9. Marketplaces y timezones

[VERIFICADO EN C?DIGO] ES/Madrid, FR/Paris, DE/Berlin, IT/Rome, BE/Brussels, NL/Amsterdam, SE/Stockholm, PL/Warsaw, GB/London, IE/Dublin, AE/Dubai, SA/Riyadh. Fechas originales se conservan como purchase_datetime_original; purchase_datetime es el instante UTC y purchase_date su proyecci?n local.

[VERIFICADO EN BD] Datos existentes observados:

| Pa?s | sales_channel | L?neas | Unidades |
|---|---|---:|---:|
| AE | Amazon.ae | 74 | 62 |
| BE | Amazon.com.be | 207 | 159 |
| DE | Amazon.de | 1207 | 975 |
| ES | Amazon.es | 9346 | 8608 |
| FR | Amazon.fr | 1934 | 1585 |
| GB | Amazon.co.uk | 1068 | 943 |
| IE | Amazon.ie | 41 | 38 |
| IT | Amazon.it | 2077 | 1800 |
| NL | Amazon.nl | 36 | 30 |
| PL | Amazon.pl | 4 | 4 |
| SA | Amazon.sa | 56 | 52 |
| SE | Amazon.se | 29 | 24 |
| UNKNOWN | Non-Amazon | 48 | 105 |

El scope default de generaci?n conserva los 7 marketplaces EU configurados anteriormente. El servicio acepta scopes expl?citos de los 12 conocidos, pero su habilitaci?n requiere una futura revisi?n autorizada. No se a?ade un marketplace silenciosamente al scope. Los canales observados fuera del scope solicitado se conservan y registran en observedCountries; no certifican cobertura adicional. Metadata incompatible de report o rango observado fuera del intervalo bloquea la importaci?n.

Un marketplace solicitado desconocido se rechaza. Un sales-channel desconocido en un documento se conserva como UNKNOWN, UTC expl?cito y sin cobertura adicional. Non-Amazon se conserva como NON_AMAZON; no se afirma que sea MCF [INFERENCIA posible, no clasificaci?n destructiva].

## 10. Idempotencia y limitaci?n de l?nea

[VERIFICADO EN C?DIGO] Se mantiene exactamente el fingerprint hist?rico: SHA-256 de all_orders|order|SKU|ASIN. No hay cambio de clave ni backfill. Reimportar reemplaza el agregado, nunca suma a la cantidad ya almacenada. Last-updated-date/report_observed_at impide que un documento antiguo vuelva a Pending despu?s de una actualizaci?n m?s reciente. Pending, Shipped, Cancelled y cantidad 0 se conservan.

L?neas de la misma clave dentro del report se suman ?nicamente si sus estados, canal, sales-channel y instante de compra son coherentes; una discrepancia bloquea el documento completo. Sin identificador fiable no se puede distinguir una duplicaci?n f?sica del fichero de l?neas leg?timas id?nticas; queda como limitaci?n expl?cita, no como certeza de deduplicaci?n perfecta.

La documentaci?n oficial de Order Reports lista order-item-id para este tipo; la descripci?n de FBA del mismo report no lo lista. [NO VERIFICABLE] No se verific? su presencia/estabilidad en un nuevo report real. Se captura cuando aparece (tambi?n amazon-order-item-id), sin cambiar el fingerprint. Si el agregado combina identificadores distintos, el identificador escalar queda null; no se elige uno como identidad de la l?nea agregada. Una futura revisi?n de samples reales decidir? si hace falta clave por order-item-id y una migraci?n separada.

Fuentes: https://developer-docs.amazon/sp-api/docs/report-type-values-order y https://developer-docs.amazon/sp-api/lang-en_us/docs/report-type-values-fba .

[VERIFICADO EN TEST] Una p?rdida de respuesta despu?s de commit no puede sobrescribir un job COMPLETED con FAILED: el RPC rechaza modificaciones de una operaci?n terminal. El siguiente recovery consulta el resultado persistido. Fallos de FK hacen rollback de filas y cobertura; leases inv?lidos/expirados y cambios del manifiesto se rechazan.

## 11. Unknown y descatalogados

[VERIFICADO EN C?DIGO] Desconocidos quedan producto_id null y conservan originales/procedencia. No bloquean el pipeline, no se borran ni se vinculan por EAN. Los productos descatalogados existentes se incluyen en la evidencia de identidad de ventas; no se modifica su estado de cat?logo. Se preservan Cancelled y Pending; no se implementa consumidor de demanda.

## 12. FBA / FBM

[VERIFICADO EN C?DIGO] Solo fulfillment-channel decide canal: Amazon/AFN/FBA ? FBA; Merchant/MFN/FBM ? FBM. El string Amazon original queda en fulfillment_channel_original. Un valor inesperado produce error expl?cito y no certifica cobertura. Nunca se usa SKU, EAN, prefijo o alias para decidir el canal. Un producto puede vender por ambos canales.

[VERIFICADO EN BD] Replay global: FBA 6871 ? 6871; FBM 7514 ? 7514; total 14.385. No se escribi? ning?n resultado.

## 13. Tests

[VERIFICADO EN TEST] Tests focales finales: 87/87 PASS, con red real bloqueada. Cubren identidad ?nica/contradictoria, alias temprano frente a ASIN duplicado, SKU exacto, alias seguro, EAN compartido, heur?stica no asignable, desconocidos, FBA/FBM, estados, quantity 0, duplicados, reports repetidos, rangos y chunks, cobertura completa/parcial/ausente/fallida/en curso, cero ventas, medianoche ES/GB/IE/AE/SA, Non-Amazon, autenticaci?n, HTTP 409 y flag deshabilitado.

PostgreSQL en memoria PGlite: migraci?n aplicada y repetida solo en BD aislada local, transacci?n con rollback tard?o, idempotencia, estados y guard contra report antiguo, leases, manifiesto inmutable, permisos, job legacy FBA no bloqueante, cero filas v?lido y cobertura parcial real. No se us? una BD operativa local/remota para escribir fixtures.

Suite Amazon ampliada: 654 tests, 646 PASS y 8 FAIL. Fallos en amazonInventoryRequestOwnership.test.mjs (assertion antigua requestFbaLedgerReportJob), fbaSalesRoutes.test.mjs (6 mocks sin fbaLedgerSyncRecovery) e inventorySummarySafetyGate.test.mjs (texto anterior de UI). Sus archivos objetivo protegidos tienen el mismo diff que el checkpoint y no se modificaron en esta tarea. No se corrigieron estos fallos ajenos. No se presenta la suite completa como verde.

Logs: ../../outputs/amazon-orders-phase1/focused-tests.log y related-tests.log. No se hizo build/deploy ni prueba UI que invoque sincronizaci?n real.

## 14. Typecheck y lint

[VERIFICADO EN TEST] Typecheck global: npx tsc --noEmit --incremental false, PASS. Lint de todos los archivos TS/MJS tocados con eslint-config-next y parser TypeScript, PASS. La configuraci?n de lint es un artefacto aislado; no se a?adi? configuraci?n al proyecto. git diff --check de los owners tracked y comprobaci?n de whitespace de archivos tocados, PASS. El warning MODULE_TYPELESS_PACKAGE_JSON de los tests es preexistente; no se cambia package.json.

## 15. Simulaci?n READ ONLY before/after

[VERIFICADO EN BD] Transacci?n REPEATABLE READ READ ONLY. 16.127 l?neas, 14.385 unidades, 4.510 l?neas null, 179 SKU null, 161 ASIN null. Comparaci?n de hash de amazon_order_items intacta; ning?n producto conocido cambi? ni qued? bloqueado.

| Categor?a | SKU | L?neas | Unidades | % de 4.307 |
|---|---:|---:|---:|---:|
| SAFE_BY_ASIN | 1 | 4 | 3 | 0,0697% |
| SAFE_BY_SKU_EXACT | 0 | 0 | 0 | 0% |
| SAFE_BY_ALIAS | 0 | 0 | 0 | 0% |
| IDENTITY_CONFLICT / IDENTITY_AMBIGUOUS | 0 | 0 | 0 | 0% |
| UNRESOLVED | 178 | 4.506 | 4.304 | 99,9303% |
| Total actual sin producto | 179 | 4.510 | 4.307 | 100% |

Evidencia recuperable, sin hardcodear el producto en el resolver:

| seller_sku | ASIN | producto_id | Producto | Fuente | L?neas | Unidades | FBA | FBM |
|---|---|---|---|---|---:|---:|---:|---:|
| f8436616610654 | B0H33X8TQ4 | 93c7419b-7bb8-44d7-abd5-6db0e7e46dea | ROVER-GRIS | PRODUCT_ASIN | 4 | 3 | 3 | 0 |

Incluye 2 unidades Shipped, 1 Pending y una fila Cancelled con quantity 0. Las cuatro filas permanecen originales. ALAIA: 1.262 filas de los SKU can?nico/FBA comprobados, cero cambios de identidad.

Periodo 02/07/2026?11/08/2026 inclusivo, excluyendo order_status cancelado como en la auditor?a anterior, solo simulaci?n:

| Escenario | FBA | FBM | TOTAL |
|---|---:|---:|---:|
| Toda la cuenta | 2.561 | 3.536 | 6.097 |
| ERP actualmente | 2.097 | 1.874 | 3.971 |
| Despu?s de ASIN | 2.097 | 1.874 | 3.971 |
| Despu?s de ASIN + exacto/alias | 2.097 | 1.874 | 3.971 |
| Todav?a sin resolver | 464 | 1.662 | 2.126 |

ROVER recuperable es de septiembre, fuera de ese periodo. No hay evidencia para llamar a las 2.126 unidades restantes productos ajenos al ERP: siguen sin identidad demostrada, posiblemente hist?ricos/descatalogados/otros productos [INFERENCIA]. Se incluyen los canales existentes Non-Amazon en toda la cuenta como en la comparaci?n anterior; una futura capa sem?ntica podr? excluirlos expl?citamente.

Evidencia completa (clasificaci?n de todos los SKU/ASIN, UUID por fila recuperable, aliases sospechosos, marketplaces y maestro): ../../outputs/amazon-orders-phase1/read-only-replay.json .

## 16. Archivos tocados y diff

Dos owners tracked ampliados: amazonInventoryIdentityResolver.ts y operationalAmazonIdentityRepository.ts. Cuatro archivos All Orders previamente untracked modificados: parser, servicio, import route y cron orders-sync. Nuevos m?dulos: policy, coordinator, repository, document y HTTP. Nuevas rutas dedicadas: generate, recover y coverage. Cuatro nuevos archivos de tests. Un script de replay READ ONLY. Una migraci?n preparada. Este informe y artefactos locales de evidencia.

Archivos de implementaci?n/tests/migraci?n:

- modules/amazon-sp-api/amazonInventoryIdentityResolver.ts
- modules/amazon-sp-api/operationalAmazonIdentityRepository.ts
- modules/amazon-sp-api/allOrdersReportParser.ts
- modules/amazon-sp-api/allOrdersSalesSyncService.ts
- app/api/amazon/reports/all-orders/import/route.ts
- app/api/cron/amazon/orders-sync/route.ts
- modules/amazon-sp-api/allOrdersSyncPolicy.ts
- modules/amazon-sp-api/allOrdersSyncCoordinator.ts
- modules/amazon-sp-api/allOrdersSyncRepository.ts
- modules/amazon-sp-api/allOrdersHttp.ts
- modules/amazon-sp-api/allOrdersDocument.ts
- app/api/cron/amazon/orders-sync/generate/route.ts
- app/api/cron/amazon/orders-sync/recover/route.ts
- app/api/cron/amazon/orders-sync/coverage-status/route.ts
- modules/amazon-sp-api/allOrdersCanonical.test.mjs
- modules/amazon-sp-api/allOrdersSyncDatabase.test.mjs
- modules/amazon-sp-api/allOrdersDocument.test.mjs
- modules/amazon-sp-api/allOrdersRoutes.test.mjs
- scripts/amazon-orders-identity-readonly.mjs
- sql/migrations/20261007_01_amazon_orders_canonical.sql

Diff revisable: ../../outputs/amazon-orders-phase1/review.diff . Los archivos previamente untracked aparecen como nuevos contra NUL en Git; el diff tracked del repository incluye tambi?n su keyset previo, identificado en el checkpoint. Estado Git completo: ../../outputs/amazon-orders-phase1/final-git-status.txt .

[VERIFICADO EN C?DIGO] No se modificaron forecast/planner, Finance, ventas_diarias, sync_ventas_diarias_from_amazon_fba_sales, stock por pa?s, inventario FBA/FBM, env?os, Pan-EU/UK, productos, scheduler compartido, configuraci?n cron ni despliegue. Sus cambios preexistentes permanecen.

## 17. Riesgos pendientes

- [NO VERIFICABLE] Contrato real del report nuevo: metadata marketplace/rango, cabeceras, order-item-id y redondeo de timestamps; la validaci?n ser? fail-safe.
- [INFERENCIA] Ledger/productos son evidencia persistida, no prueba contra toda corrupci?n hist?rica posible. Un mapping incorrecto coherente podr?a necesitar revisi?n humana; se conservan conflictos y versiones.
- [VERIFICADO EN BD] EAN compartidos restantes y 9 env?os sospechosos son deuda, no autoridad de ventas.
- [VERIFICADO EN C?DIGO] Fingerprint sin marketplace/order-item-id mantiene compatibilidad, pero no garantiza identidad perfecta de cada l?nea Amazon. Estados/canales divergentes bloquean el fichero antes de perder evidencia.
- [VERIFICADO EN C?DIGO] Un report hist?rico agregado puede contener Non-Amazon; se preserva y no se da por confirmado MCF.
- [VERIFICADO EN C?DIGO] Reports por marketplace pueden observar datos de otros pa?ses; las filas se conservan por clave, pero solo el scope expl?cito obtiene cobertura. No sumar rowsUpserted de ventanas como ventas ?nicas: puede haber reimportaciones solapadas.
- [VERIFICADO EN C?DIGO] rowsUpserted cuenta registros del documento enviados al upsert; un guard contra datos antiguos puede evitar modificaciones. Las ventas se cuentan en amazon_order_items por fingerprint, no por ese contador.
- [VERIFICADO EN C?DIGO] La cobertura anterior no se inventa y el d?a actual sigue PARTIAL; no existe todav?a activaci?n server-side peri?dica.
- [VERIFICADO EN TEST] 8 fallos de suite amplia ajenos permanecen. No se afirma deploy-ready ni se realiz? una sincronizaci?n integrada real.
- [VERIFICADO EN C?DIGO] No migrar consumidores ni combinar purchase-date con shipment-date evita introducir el doble conteo de ventas_diarias en esta fase.

## 18. Migraci?n preparada, no ejecutada remotamente

sql/migrations/20261007_01_amazon_orders_canonical.sql. A?ade 8 columnas justificadas: fecha/canal originales, identificador de l?nea opcional, clasificaci?n marketplace, timezone expl?cita, procedencia de identidad JSON y timestamp del report para monotonicidad; crea las dos tablas aisladas de operaciones/cobertura, ?ndice singleton y 4 RPC con service_role y fencing. No contiene backfill ni correcciones de amazon_envios/productos/inventarios. Solo se ejecut? en PGlite en memoria como test.

## 19. Siguiente prueba real propuesta ? NO ejecutada

Primero revisar/aprobar diff y migraci?n y verificar el esquema destino en READ ONLY. Despu?s, con autorizaci?n separada, aplicar la migraci?n y habilitar temporalmente el flag en un entorno acordado; solicitar un solo rango hist?rico peque?o para ES, observar una transici?n por tick y comparar un documento real con filas/cobertura persistidas. Verificar replay id?ntico, cero duplicados, originales, identidades desconocidas y canales, luego ampliar a scopes adicionales. No activar cron ni consumidores de forecast durante esa prueba.

STOP. En esta tarea no hubo llamadas SP-API, reports nuevos, sincronizaci?n real, recovery real, escrituras remotas, migraciones remotas, publicaci?n/despliegue ni activaci?n de cron. No se continu? ninguna sincronizaci?n FBM.
