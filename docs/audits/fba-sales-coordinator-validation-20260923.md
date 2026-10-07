# Auditoría FBA Sales — 2026-09-23

## A. Estado final

**VERIFICADO EN CÓDIGO / VERIFICADO POR TEST.** Se conserva el coordinador existente. Manual, cron de importación, cron horario y syncOnly usan el mismo propietario de publicación. Cada invocación avanza un paso acotado; no hay sleeps. Crear un informe, recibir DONE o descargarlo no equivale a COMPLETED.

**VERIFICADO EN SQL.** `commit_fba_sales_chunk` integra RAW, canonicalización a `ventas_diarias`, checkpoint y, únicamente al completar todos los chunks, `amazon_sync_jobs`. Una excepción revierte esa publicación entera. Los chunks previamente confirmados permanecen si falla un chunk posterior. `checkpoint_fba_sales_sync` rechaza COMPLETED; SQL construye el progreso definitivo.

**VERIFICADO POR TEST.** Rangos inclusivos de 1, 7, 30, 31, 60, 90, 91, 120 y 365 días: todos los días exactamente una vez, máximo 30 por bloque, cruces de año, febrero bisiesto y transiciones DST. Worker probado también con TZ Europe/Madrid y America/New_York. El rango solicitado produce exactamente:

```
2026-06-24 → 2026-07-23
2026-07-24 → 2026-08-22
2026-08-23 → 2026-09-21
```

**VERIFICADO EN SQL / VERIFICADO POR TEST.** Lease común, exclusión FIFO, UNIQUE de solicitudes activas, rechazo de lease vencido y checkpoint antiguo, rechazo de finalización directa, rollback ante fallo canonical y ante fallo final de `amazon_sync_jobs`. Repetir la misma identidad actualiza RAW sin duplicarlo y reconstruye el grano canonical sin duplicarlo; otras fuentes se conservan. Esta garantía no cubre los tres cambios de identidad/ausencia del apartado E.

**VERIFICADO EN CÓDIGO / VERIFICADO POR TEST.** El 429 conserva reportId/documentId y persiste `nextAttemptAt`; Retry-After numérico y HTTP-date se respetan. Create usa cero reintentos internos y un intento persistido antes de llamar a Amazon. Un resultado de creación desconocido queda FAILED y no se recrea automáticamente.

**NO VERIFICADO.** No hubo llamadas Amazon, migraciones remotas, despliegue, commit ni push. PGlite prueba SQL sobre un esquema aislado, no el esquema real ni dos conexiones PostgreSQL remotas concurrentes. El cierre local no equivale a autorización para producción.

## B. Archivos exactos y procedencia

**VERIFICADO EN CÓDIGO.** Se ejecutó git status al inicio y se revisaron diffs y archivos nuevos. El registro de la sesión anterior `01a0c780-8d6e-7fa0-9c90-a97929c6999b` confirma el trabajo FBA. Su último parche añadió el cierre de `amazon_sync_jobs` y la dependencia SQL del test, sin validación posterior registrada. Todos los archivos siguientes ya estaban pendientes al empezar; “Sí” identifica los que esta auditoría ha vuelto a modificar.

| Archivo | Editado ahora | Propósito final |
|---|---|---|
| `modules/amazon-sp-api/fbaSalesSyncPolicy.ts` | No | Fechas UTC, chunks, estados y reintentos |
| `modules/amazon-sp-api/fbaSalesSyncWorker.ts` | Sí | Secuencia reanudable; comprobación exacta del rango declarado |
| `modules/amazon-sp-api/fbaSalesSyncCoordinator.ts` | No | Claim, leases, SP-API, RPC y reanudación |
| `modules/amazon-sp-api/fbaForecastSpApiImportsService.ts` | No | Parser validado y delegación de persistencia atómica |
| `modules/amazon-sp-api/boundedReportDocument.ts` | No | Descarga acotada y propagación de 429/Retry-After |
| `modules/amazon-sp-api/reportJobsRepository.ts` | No | Claim estable y exclusión del poller ajeno |
| `modules/amazon-sp-api/types.ts` | No | Estados semánticos del coordinador |
| `app/api/amazon/reports/fba-sales/import/route.ts` | No | Autenticación, importación y reanudación manual |
| `app/api/cron/amazon-sp-api/reports/fba-sales/import/route.ts` | No | Importación/reanudación cron |
| `app/api/cron/amazon-sp-api/reports/fba-sales-to-ventas-diarias/route.ts` | No | syncOnly mediante coordinador |
| `app/api/cron/amazon/reports/run/route.ts` | Sí | Recuperación horaria y HTTP 502 ante fallo FBA |
| `modules/inventory/components/InventoryPage.tsx` | Sí | Éxito solo con COMPLETED; corrección de texto deteriorado |
| `modules/inventory/services/inventoryCanonicalRefreshUi.test.mjs` | No | Contrato UI de actualización canonical |
| `modules/amazon-sp-api/fbaSalesSyncWorker.test.mjs` | Sí | Rangos exactos, días únicos, estados y reintentos |
| `modules/amazon-sp-api/fbaSalesSyncDatabase.test.mjs` | Sí | SQL, permisos, rollback, cierre final y preflight |
| `modules/amazon-sp-api/fbaSalesDocument.test.mjs` | No | Parser, idempotencia estable y semántica pendiente |
| `modules/amazon-sp-api/fbaSalesRoutes.test.mjs` | Sí | Manual, import cron, syncOnly y cron horario |
| `modules/amazon-sp-api/fbaSalesMarketplaceScope.test.mjs` | No | Scope solicitado y observado |
| `sql/migrations/20260922_01_fba_sales_coordinator.sql` | Sí | Publicación atómica protegida y evidencia de rango/documento |
| `sql/migrations/20260922_02_fba_sales_marketplace_catalog.sql` | No | Catálogo fail-closed; no inventa region/language_code |

**VERIFICADO EN CÓDIGO.** Nuevos archivos de esta auditoría:

| Archivo | Propósito |
|---|---|
| `sql/diagnostics/fba_sales_coordinator_preflight_readonly.sql` | Consulta de esquema, catálogo, índices, funciones, ACL y RLS; READ ONLY + ROLLBACK |
| `docs/audits/fba-sales-coordinator-validation-20260923.md` | Este informe y prueba manual |
| `.codex-work/fba-sales-audit-tests.ps1` | Comando reproducible de la batería local |
| `.codex-work/fba-sales-test-register.mjs` | Resolución de imports TS sin extensión para Node; solo tests |
| `.codex-work/fba-sales-audit-final-tests.log` | Evidencia TAP de la ejecución final |

**VERIFICADO EN CÓDIGO.** Se preservaron los cambios preexistentes de Finanzas, cumplimiento, layout/Sidebar, planner, forecast de producto, outputs y demás archivos ajenos. No se restauraron ni sobrescribieron.

## C. Validaciones finales

| Comando | Resultado |
|---|---|
| `git diff --check` | VERIFICADO EN CÓDIGO: salida 0, sin errores de whitespace; avisos LF/CRLF |
| `npx.cmd tsc --noEmit --incremental false` | VERIFICADO POR TEST: salida 0 |
| `powershell -NoProfile -ExecutionPolicy Bypass -File .codex-work/fba-sales-audit-tests.ps1` | VERIFICADO POR TEST: 235/235, 0 fallos, 0 omitidos |
| `$env:TZ='Europe/Madrid'; node --experimental-strip-types --test modules/amazon-sp-api/fbaSalesSyncWorker.test.mjs` | VERIFICADO POR TEST: 66/66 |
| `$env:TZ='America/New_York'; node --experimental-strip-types --test modules/amazon-sp-api/fbaSalesSyncWorker.test.mjs` | VERIFICADO POR TEST: 66/66 |
| `git status --short` | VERIFICADO EN CÓDIGO: cambios pendientes conservados; sin commit |

La batería contiene 13 tests SQL/PGlite, 26 de rutas y 66 de worker, además de parser, marketplace, rate-limit, deduplicación, transporte, inventario, UI, Ledger y concurrencia. El lanzador enumera los 29 archivos ejecutados. Reutiliza PGlite ya instalado en `.codex-work/amazon-run-tests`; no instala dependencias ni carga credenciales.

La primera ejecución amplia falló al cargar dos tests existentes por imports TS sin extensión. Se resolvió en el lanzador local y se repitió toda la batería: no se alteró código de Inventario/Ledger para acomodar el test. ExecutionPolicy Bypass se limita al proceso del lanzador; no cambia la configuración del sistema.

## D. Problemas corregidos ahora

- **VERIFICADO POR TEST:** el worker aceptaba fechas ausentes o rangos parciales dentro del mismo día. Ahora exige ambos instantes UTC solicitados, aceptando representaciones equivalentes con offset.
- **VERIFICADO EN SQL:** el commit exige evidencia persistida de DONE, tipo, documento y rango exacto; un checkpoint DOWNLOAD anterior sin esa evidencia no puede publicar.
- **VERIFICADO POR TEST:** el cron horario respondía `ok: true` ante fallo FBA. Ahora comunica `ok: false` y HTTP 502 conservando el diagnóstico.
- **VERIFICADO EN CÓDIGO:** se repararon los caracteres deteriorados del aviso pendiente en Inventario.

El cierre de `amazon_sync_jobs` ya existía; esta auditoría lo valida, no lo presenta como una corrección nueva.

## E. Pendientes

### BLOQUEANTE

**REQUIERE VERIFICACIÓN EN PRODUCCIÓN.** Bloqueada la recomendación de ejecutar migraciones/desplegar hasta revisar el preflight real: falta el DDL completo local del catálogo y no se conocen aquí las diferencias de esquema, ACL, RLS ni propietarios reales. No queda un fallo local conocido de la batería FBA.

### REQUIERE VERIFICACIÓN EN PRODUCCIÓN

Ejecutar íntegramente `sql/diagnostics/fba_sales_coordinator_preflight_readonly.sql` en el editor SQL autorizado y compartir sus resultados. Empieza por `BEGIN TRANSACTION READ ONLY; SHOW transaction_read_only;` y termina con `ROLLBACK;`. Obtiene columnas/defaults, CHECK/FK/UNIQUE, enums, UUID/currency de países, catálogo con region/language_code, índices, definiciones/owner/ACL de RPC y RLS. No llama RPC de escritura.

Faltan valores verificables para cualquier columna obligatoria sin default del catálogo, especialmente region/language_code si existen. La consulta permite identificar exactamente cuáles. Los valores de otros países no deben copiarse como si demostraran los de BE/NL/IE/AE/SA; si no hay evidencia para estos, sigue pendiente una decisión documentada del propietario del catálogo.

### PENDIENTE DE DECISIÓN FUNCIONAL

La [documentación oficial de Amazon](https://developer-docs.amazon/sp-api/docs/report-type-values-fba) describe detalles de pedido/envío/artículo, hasta un mes por informe y retrasos de aparición normalmente de 1–3 horas, excepcionalmente de hasta 24 horas. No establece en esa documentación un contrato de borrados, corrección 3→0 ni inmutabilidad de shipment-date. No hay evidencia suficiente para tratar cada descarga como sustitución completa de todas las ventas del rango.

- **PENDIENTE DE DECISIÓN FUNCIONAL:** 3→0: el parser sigue omitiendo cero, conserva el 3 anterior y puede sobrecontar si el cero fuese una rectificación real.
- **PENDIENTE DE DECISIÓN FUNCIONAL:** fila desaparecida: RAW previo permanece; puede sobrecontar si la ausencia significa eliminación. Borrar por ausencia también podría perder envíos legítimos no presentes temporalmente.
- **PENDIENTE DE DECISIÓN FUNCIONAL:** sale_date modificada: forma parte del fingerprint junto con pedido/envío/artículo/SKU; aparecen dos identidades y puede duplicarse la venta económica. No se cambia identidad histórica sin un contrato verificable.

**VERIFICADO POR TEST:** se conservan explícitamente esos comportamientos y las pruebas que los documentan. COMPLETED acredita ejecución técnica del pipeline, no reconciliación económica de esos casos.

### NO BLOQUEANTE

- **NO VERIFICADO:** rendimiento real y duración de la descarga/canonicalización; se conservan límites de tiempo/bytes y fencing de lease.
- **VERIFICADO EN CÓDIGO:** cron horario avanza un paso y depende de `AMAZON_REPORT_SCHEDULER_ENABLED`; una petición manual no completa necesariamente 90 días. No se optimiza latencia general.
- **VERIFICADO EN CÓDIGO:** FAILED/FATAL requieren diagnóstico; repetir la misma solicitud fallida no crea automáticamente otro informe. CREATE_OUTCOME_UNKNOWN debe reconciliarse antes de recuperación.

## F. Migraciones

| Migración | Estado |
|---|---|
| `20260922_01_fba_sales_coordinator.sql` | VERIFICADO EN SQL / VERIFICADO POR TEST: preparada y repetible en entorno aislado. NO ejecutar aún en producción hasta revisar dependencias y permisos reales |
| `20260922_02_fba_sales_marketplace_catalog.sql` | REQUIERE VERIFICACIÓN EN PRODUCCIÓN: NO ejecutar todavía; preservada fail-closed |

**VERIFICADO EN SQL.** Dependencias del coordinador: `amazon_spapi_report_jobs.sql`, `amazon_report_scheduler_foundation.sql`, `20260702_amazon_fba_forecast_spapi_base.sql`, `20260703_amazon_sync_jobs.sql`, `20260709_sync_ventas_diarias_from_amazon_fba_sales.sql`, `20260710_update_v_amazon_fba_sales_daily_to_amazon_fulfilled_shipments.sql`; además del catálogo y `ventas_diarias` existentes con FK/grano apropiados. No reejecutar indiscriminadamente migraciones históricas. El test aplica la base completa y 09 antes de 10, y la nueva migración al final.

**VERIFICADO EN SQL.** Nuevas funciones con search_path fijado, tablas/funciones propias calificadas, commit SECURITY DEFINER, helpers SECURITY INVOKER; PUBLIC/anon/authenticated sin EXECUTE en RPC nuevas. service_role puede ejecutar las RPC protegidas, pero no el writer canonical antiguo. Se prueba con SET ROLE service_role y permisos explícitos de fixture. El owner y los permisos reales requieren preflight. UNIQUE de fingerprint, grano de ventas y trabajo activo, locks transaccionales y segunda comprobación de lease antes del checkpoint probados localmente.

## G. Siguiente prueba manual (no ejecutada)

**NO VERIFICADO.** Hacerla solo después de resolver el preflight y disponer de estas migraciones/código en un entorno autorizado. La prueba sí crea informes Amazon y escribe ventas; no forma parte de esta auditoría.

1. Iniciar sesión en la aplicación. En DevTools, pestaña Network, conservar las respuestas. Para el rango histórico exacto, enviar desde la consola del mismo origen:

```js
const response = await fetch('/api/amazon/reports/fba-sales/import', {
  method: 'POST', headers: {'content-type':'application/json'},
  body: JSON.stringify({fromDate:'2026-06-24',toDate:'2026-09-21'})
});
const result = await response.json();
console.log(response.status, result);
```

2. Guardar `result.jobId`. Verificar los tres chunks del apartado A y el scope configurado. `202`/PENDING/PROCESSING/RATE_LIMITED significa pendiente. Esperar hasta `nextAttemptAt` si existe; no generar solicitudes nuevas para cada reanudación.
3. Reanudar enviando al mismo endpoint `{"jobId":"EL_JOB_ID_GUARDADO"}`. Alternativamente, dejar actuar el cron horario autorizado. Mantener el mismo jobId y observar que cada chunk conserva su reportId durante polling/429/descarga. El flujo ideal necesita al menos create, poll y publish por chunk; puede requerir más polls.
4. Solo aceptar HTTP 200 + `ok:true` + `status:COMPLETED`, `summary.chunkIndex:3`, todos los chunks COMPLETED con `committedAt`/`publication`, y `lastCommittedAt`. Contrastar RAW y ventas canonical por rango/marketplace, huérfanos y conflictos de otras fuentes; `amazon_sync_jobs.last_rows_upserted` debe reflejar la suma de inserted de los chunks.
5. Para probar el aviso UI de éxito, el botón de Inventario usa sus 90 días móviles, no fija este rango histórico. Mientras haya 202 debe mostrar pendiente. Repetir la reanudación del job ya completo no debe crear informes ni cambiar las ventas.
6. Detenerse ante FAILED/FATAL, error de rango, marketplace ausente o CREATE_OUTCOME_UNKNOWN; guardar jobId, reportId, chunk/error. No borrar datos ni regenerar informes a ciegas. Una repetición nueva del rango después de COMPLETED sí inicia una nueva generación; no es lo mismo que reanudar el mismo jobId.
