# FBM fase 1 — implementación local y evidencia

Fecha: 2026-09-29. Sin commit, despliegue, escrituras remotas ni ejecución de migraciones en la aplicación.
Se conservaron los cambios del usuario encontrados por `git status --short` antes de editar.
Las pruebas PostgreSQL usan PGlite efímero, sin credenciales ni conexión a Supabase.

## 1. Diagnóstico y arquitectura anterior

El POST cron delegaba en `syncAmazonFbmInventoryFromReports`: createReport, hasta doce esperas de 15 s,
polling, descarga y commit dentro de una petición de hasta 300 s (route 360 s).
`running` solo protegía una instancia. No persistía el report en `amazon_spapi_report_jobs`.
El parser, identidad exacta, validación completa y RPC de snapshot eran reutilizables.
Country leía stock_fbm y lo reenviaba en el upsert FBA: podía restaurar un valor antiguo.

## 2. Arquitectura nueva

```text
Botón admin → POST manual ─┐
Cron protegido → POST ────┼→ coordinateFbmSync → claim / lease CAS persistida
Recuperación periódica ───┘                       → CREATE | POLL | PUBLISH
                                                 → Reports API
                                                 → parser/normalizador FBM existente
                                                 → commit RPC existente
                                                 → amazon_fbm_inventory_snapshots
UI → GET autenticado → estado persistido (no avanza el trabajo)
```

No se creó tabla ni migración. No se movieron routes. El antiguo servicio monolítico permanece para
compatibilidad y sus pruebas, pero el grafo de routes productivas ya no lo llama.

## 3. Contrato del job

- Tabla: `amazon_spapi_report_jobs`.
- Owner/source: `fbm_reports_coordinator_v1`.
- Scope: `EU:OWN_ES:FBM:A1RKKUPIHCS9HS`.
- Report: `GET_MERCHANT_LISTINGS_ALL_DATA`; marketplace ES.
- Identidad de generación: claim UUID existente, bucket fijo y UUID del predecesor.
  Inicios concurrentes con el mismo predecesor reclaman la misma PK PostgreSQL.
- `raw.fbm`: versión, scope, fase, estado, revisión, lease/token/expiry, intentos, próximo intento,
  error seguro, intención CREATE, identidad exacta inicial, reportId/documentId, observedAt,
  completedAt y recibo de publicación (runId, filas, digest).
- `report_id`, `report_document_id`, `processing_status`, `status` y `completed_at` también quedan en columnas normales.
- Lease: 120 s. Paso Amazon/publicación: señal global de 45 s, requests Amazon como máximo 30 s.
- La lease se adquiere mediante UPDATE compare-and-swap por revisión JSONB. Cada checkpoint exige
  revisión, owner, report type, token y lease vigente. No depende de memoria o timers.
- No se fuerza el uso de `amazon_report_sync_runs`: su lock histórico no aporta fencing de checkpoints
  de este owner. El job conserva la lease y el snapshot conserva su run. Se reutiliza el claim existente.

## 4. Estados y transiciones

| Fase / evento | Resultado |
|---|---|
| CREATE sin intención previa | Persiste identidad e intención; una llamada createReport; persiste reportId inmediatamente; POLL/PENDING |
| Reinicio con intención CREATE y sin reportId | CREATE_UNCERTAIN; nunca regenera automáticamente |
| CREATE con 429 confirmado | RATE_LIMITED; permite reintento después del backoff |
| POLL IN_QUEUE / IN_PROGRESS | PROCESSING, HTTP 202, reportId intacto, próximo intento persistido |
| POLL DONE | PUBLISH/PROCESSING; una siguiente invocación publica |
| POLL CANCELLED / FATAL | Terminal explícito; no descarga ni publica |
| 429 / timeout / fallo temporal | Conserva job/fase/reportId; RATE_LIMITED o PENDING con backoff y Retry-After |
| PUBLISH validado y confirmado | COMPLETED; HTTP 200, runId y número de filas |
| Identidad, cobertura, duplicados o evidencia inválida | FAILED, sin snapshot parcial |
| Repetición de COMPLETED | Devuelve el resultado persistido |

Cron no regenera terminales fallidos. Manual puede solicitar explícitamente un sucesor con
`retryAfterJobId` para CANCELLED/FATAL/FAILED. El botón lo envía al volver a pulsar tras ese error.
CREATE_UNCERTAIN queda retenido para reconciliación operativa; no admite ese bypass.
Tras COMPLETED hay un mínimo de cinco minutos antes de generar otro trabajo equivalente.

## 5. Publicación e idempotencia

Se mantienen `fbmProductIdentityRepository`, `fbmReportsSnapshot`, `boundedReportDocument`
y `fbmReportsCommit`: DEFAULT exacto, literal cero, sin cero inferido, cobertura completa,
identidades desde productos y revalidación antes del commit. El informe conserva su `createdTime`
como `observed_at`. Límites existentes: 20 MiB y 200.000 filas; una consulta de estado por paso.

`snapshot_run_id = job.id`. Antes del RPC se persiste un digest del payload y cantidad esperada.
El RPC existente inserta run y filas en una transacción. Su PK impide dos publicaciones del mismo job.
Antes de publicar o tras una respuesta perdida se consulta run + todas sus filas y se compara
marketplace, observed_at, cantidades de cobertura, número de filas y digest. Solo esa confirmación
permite COMPLETED. El segundo commit puede encontrar conflicto de PK; se reconcilia por lectura.

## 6. Botón, cron y recuperación

- Inventario: `Actualizar stock FBM`, componente separado `FbmSyncButton`.
- POST manual: `/api/amazon/inventory/fbm-snapshot/import`; sesión + `app_metadata.role=admin`.
- GET del mismo endpoint observa el último job o un jobId; no llama Amazon ni crea trabajo.
- Doble clic: ref síncrona + botón deshabilitado; concurrencia entre pestañas/instancias: lease durable.
- HTTP 202 es trabajo pendiente, no error. El navegador consulta estado cada 30 s.
- POST cron existente: `/api/cron/amazon/fbm-inventory-snapshot`; Bearer CRON_SECRET + opt-in.
- GET/POST de recuperación: `/api/cron/amazon/fbm-inventory-snapshot/recover`; Bearer CRON_SECRET;
  avanza exclusivamente el job existente, nunca crea otra generación.
- El cron horario ya declarado en `vercel.json`, `/api/cron/amazon/reports/run`, llama a recuperación
  FBM antes del scheduler legacy. El switch del scheduler legacy no bloquea esa recuperación.
- No se modificó `vercel.json`. Para menor latencia puede programarse el endpoint de recuperación
  cada minuto en cualquier scheduler HTTP. El coordinador no importa APIs de Vercel.
- Sin un scheduler ejecutándose, ninguna aplicación apagada puede progresar. En local, el script
  `scripts/run-fbm-recovery-once.cjs` permite actuar como tick externo FBM sin invocar FBA.

## 7. Aislamiento

El selector genérico `listAmazonReportJobsPendingPoll` añade solo
`.neq("source", "fbm_reports_coordinator_v1")`. Preview/commit ya filtran report types Country/Ledger.
Las peticiones programadas del scheduler solo soportan sus tipos anteriores.
Un test ejecuta la consulta anterior y la nueva en PostgreSQL aislado y compara todos los otros jobs.
El conflicto preexistente del scheduler con All Orders NO se arregla ni se amplía aquí.

## 8. Contrato canónico verificado

`20260903_01_amazon_fbm_inventory_atomic_snapshot.sql` define una vista que elige el último run
COMPLETE/publication_ready por marketplace, ordenando observed_at y completed_at, y agrega cantidades
solo de ese run por producto. No selecciona el último registro individual de cada SKU.

Preflight remoto READ ONLY: tablas y columnas accesibles. La vista coincide con la reconstrucción de
los últimos snapshots publicables: **1 marketplace, 68 productos**. Esto verifica los datos actuales;
no se obtuvo la definición SQL desplegada ni se ejecutó el RPC de escritura remoto.

No existe columna `source`, `job_id` ni `report_id` en el esquema base de snapshots confirmado.
La trazabilidad nueva se obtiene por snapshot_run_id = job.id y source/report_id del job.
Los runs históricos sin job conservarán esos campos NULL en la consulta de comprobación.

## 9. Auditoría stock_fbm (código ejecutable y SQL local)

| Superficie | Clasificación | Tratamiento |
|---|---|---|
| Country `repository.ts / upsertInventarioPaisesStockFba` | PRESERVADOR → ya no escritor FBM | Retirados lectura previa y campo del payload; PostgreSQL test conserva Y aunque Country comenzó con X |
| Country `loadExistingStockFbmByKeys` | LEGACY | Helper no invocado, retenido para no borrar legacy |
| Ledger y Inventory Summaries | Sin escritura legacy FBM | Persisten sus tablas FBA; sin cambio |
| Sales, All Orders, Inbound | Sin escritura legacy FBM | Sin cambio |
| Inventory `inventoryRepository` (`inventario_paises`) | LECTOR solo de FBA | La consulta de filas ya no selecciona `stock_fbm` ni `stock_pais`; las sugerencias tampoco leen FBM legacy |
| Inventory `resolveOperationalStock` | LECTOR canónico | Resumen por país y stock operativo usan snapshots; FBM legacy ya no interviene |
| Inventory `buildInventoryProduct / buildCountryRowsForProduct` | LECTOR legacy corregido | Retirado fallback a stock_fbm; snapshot cero se conserva, ausencia FBM es NULL |
| Inventory `inventoryScope / stockForChannelRow` y forecast annual opening stock | LECTOR FBA; FBM desde snapshot | Los scopes FBM y ALL incorporan el snapshot canónico en ES; ningún fallback a stock_fbm legacy |
| Products `productInventoryRepository` → `productDetailMapper` | LECTOR | Deuda: contrato detalle, agregados y unknown requieren cambio coordinado |
| Products `productCatalogMapper` y `types/catalog.types` | LECTOR indirecto | Deuda de vista catálogo |
| Products `ProductInventoryCard`, `ProductDetailKpis` | LECTOR indirecto UI | Muestran el contrato legacy de detalle; deuda |
| Orders `products-search/route.ts` | LECTOR | Deuda: contrato de búsqueda/cobertura y DTO de pedidos |
| Orders `suggestions/route.ts` | LECTOR directo y por vistas | Deuda: sugerencias y cálculo de planificación, fuera de alcance |
| Orders `OrderFormModal`, `pedidos/page.tsx`, DTOs | LECTOR indirecto / tipos | Heredan los endpoints anteriores |
| Planner `plannerRepository.ts` | LECTOR directo y de catálogo | Deuda explícita; no modificar forecasting/planner |
| `sql/views/v_productos_catalogo.sql`, migración `sync_v_productos_catalogo_categoria_id.sql` | LECTOR SQL | Deuda: vistas desplegadas; no se aplican migraciones |
| `sql/views/v_stock_seguridad_sugerido.sql` | LECTOR SQL | Deuda: planificación y sugerencias |
| `sql/migrations/fase3_stock_entregado.sql / fn_stock_add` | ESCRITOR LEGACY; ejecución remota NO DETERMINABLE | Código SQL antiguo suma stock_fbm. Servicio de contenedores ya excluye destinos FBM. No se ejecuta ni modifica la función remota |
| `applyContainerStock` / `containerStockRepository.callFnStockAdd` | Wrapper legacy; FBM excluido antes de llamada | Sin cambio; guard existente preservado |
| `sql/diagnostics/*` con stock_fbm | LECTOR / LEGACY diagnóstico | No modifica datos; algunos comentarios antiguos ya no describen la autoridad actual |
| Interfaces/types y comentarios restantes | LEGACY / no acceso a datos por sí mismos | No son escritores |
| `v_latest_amazon_fbm_inventory_by_product.stock_fbm` | LECTOR CANÓNICO | Mismo nombre de campo, procedencia snapshots: no confundir con la columna legacy |

La columna `inventario_paises.stock_fbm` se conserva por compatibilidad, sin autoridad canónica.
Los consumidores legacy enumerados aún pueden mostrar cifras antiguas; esta fase no afirma haber
migrado catálogo/pedidos/planner completos. Su sustitución requiere una fase acotada de lectores y,
para vistas SQL, autorización de despliegue. Los totales por país actuales mantienen su contrato
numérico de unidades conocidas; FBM desconocido se presenta NULL, sin recuperar legacy.

## 10. Variables

Antes: AMAZON_FBM_REPORTS_SYNC_ENABLED exigía exactamente `true` para ejecutar el único endpoint FBM cron.
Ahora: controla creación automática vía ese POST; NO controla el botón.

Añadir explícitamente a .env.local (no se editó):

```dotenv
AMAZON_FBM_MANUAL_SYNC_ENABLED=true
AMAZON_FBM_REPORTS_SYNC_ENABLED=false
```

Para permitir además inicio automático por cron, usar `AMAZON_FBM_REPORTS_SYNC_ENABLED=true`.
Configurar CRON_SECRET con un secreto propio si falta, sin copiarlo al repositorio.
El botón requiere admin en app_metadata. Mantener credenciales ya existentes:
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET, AMAZON_LWA_REFRESH_TOKEN,
AMAZON_MARKETPLACE_ES=A1RKKUPIHCS9HS, región EU y AWS SigV4 desactivado.
Desarrollo habilita manual por defecto salvo `false`; producción requiere `true` explícito.
Recovery está habilitado si manual o automatización están habilitados. Ambas en false deshabilitan FBM.
`.env.example` no existía y se creó con las dos opciones FBM, sin secretos.

## 11. Validación y riesgos

Suite relacionada (FBM existente + nueva, selectors, FBA Sales route regressions, Inventory):
191 tests, 191 pass, 0 fail, 0 skipped. Tests incluyen PostgreSQL real embebido para CAS/PK,
publication RPC, respuesta perdida y Country, además de autorización y HTTP 202.
Los scripts usan Node test y el registro TS ya empleado por el repositorio.

Validación final: suite relacionada 191/191 pass, 0 fail/skip; `npx.cmd tsc --noEmit --incremental false`
pass; ESLint acotado a los archivos FBM/Country/Inventory pass. `npm.cmd run build` completo pass:
compilación, tipos, recolección de datos, 42 páginas estáticas y generación de rutas.
La primera ejecución en sandbox no pudo descargar Google Fonts; con red y en el build final terminó bien.

Riesgos pendientes:

- No se hizo LIVE createReport/commit ni deploy: prueba manual final queda para el operador.
- CREATE_UNCERTAIN requiere diagnóstico/reconciliación operativa del informe; no existe una UI para
  asociar un reportId dudoso. Se conserva el job y nunca se vuelve a crear automáticamente.
- Deuda de lectores legacy y posible RPC legacy desplegado, según matriz anterior.
- Recovery horario puede tardar horas entre fases; configurar el endpoint dedicado cada minuto
  para UX rápida. Frecuencia, disponibilidad del scheduler y límites HTTP del proveedor deben verificarse al desplegar.
- La RPC publicada, sus grants/RLS y la ausencia de triggers remotos adicionales no quedan probadas
  por leer tablas. Se conservaron la RPC y sus argumentos existentes; no se ejecutó ninguna migración.
- El servicio monolítico antiguo se conserva sin consumidor de route; no reconectarlo.

## 12. Prueba manual exacta (el operador autoriza estas llamadas Amazon)

1. Añadir variables anteriores y comprobar que el usuario tiene app_metadata.role=admin.
2. `npm.cmd run dev` en la raíz. Abrir Inventario e iniciar sesión.
3. Pulsar `Actualizar stock FBM`: esperar HTTP 202, jobId/reportId y botón `FBM en curso`.
4. En otra consola, ejecutar `node scripts/run-fbm-recovery-once.cjs`. Si el próximo intento aún no
   llegó, devuelve el mismo job sin consultar Amazon. Repetir después de nextAttemptAt.
5. IN_QUEUE/IN_PROGRESS: HTTP 202, mismo job/reportId, snapshot anterior intacto.
6. DONE: phase=PUBLISH; el siguiente tick publica. COMPLETED: HTTP 200, snapshotRunId, filas confirmadas.
   La página observa GET cada 30 s y refresca el inventario al completar.
7. Cerrar navegador y ejecutar los ticks externos: deben completar el mismo job. Reiniciar servidor
   entre CREATE/POLL conserva reportId; tras una interrupción con lease activa puede esperar hasta 120 s.
8. Para simular scheduler local continuo, en una consola separada:

```powershell
while ($true) {
  node scripts/run-fbm-recovery-once.cjs
  Start-Sleep -Seconds 30
}
```

Este sleep pertenece al scheduler externo, nunca a una request de la aplicación. Ctrl+C detiene el
scheduler local. No ejecutar el cron general como prueba local: también ejecuta pipelines ajenos.

9. Ejecutar en SQL Editor **solo** `sql/diagnostics/fbm_phase1_snapshot_readonly.sql`.
   Comprobar reportId, job, último run publicable, SKU, cantidad y observed_at. Para los nuevos runs,
   snapshot_run_id debe coincidir con job_id y source debe ser fbm_reports_coordinator_v1.
10. Repetir un tick: no aumenta el número de snapshots del job completado.

No interpretar 200 de una consulta GET como publicación: comprobar status=COMPLETED y recibo confirmado.
