# Auditoría física de `C:\ERP_BACKUP`

**Fecha:** 2026-08-06
**Modo:** inspección exclusivamente de lectura
**Proyecto comparado:** `C:\Users\Jennifer\Desktop\bussines + erp\ERP_BI_IA`
**Base ya auditada:** contenedor `supabase_db_ERP_BACKUP`, PostgreSQL 17.6
**Informe base utilizado:** `docs/financial/FINANCIAL_MODULE_AUDIT.md`

No se ejecutó ningún SQL, script, dump, migración, restauración ni comando de arranque/parada. No se abrió el contenido de los archivos de secretos generados por Supabase CLI. Solo se consultaron nombres, rutas y metadatos de mounts; los valores sensibles permanecieron ocultos. La única escritura de esta fase es este documento.

## 1. Resumen

`C:\ERP_BACKUP` es una **combinación de proyecto local Supabase CLI, almacén de backups, evidencias de migraciones y scripts de prueba financiera**. No es una copia del código de `ERP_BI_IA`, no contiene un Docker Compose mantenido manualmente y tampoco contiene el directorio físico de datos PostgreSQL.

Sus cuatro componentes son:

1. `supabase/config.toml`: configuración activa que identifica el proyecto Supabase CLI como `ERP_BACKUP` y define puertos/servicios.
2. `supabase/.temp`: artefactos efímeros generados por Supabase CLI para levantar el stack; incluye ficheros de secretos que no se inspeccionaron.
3. `backups`: snapshots SQL y dumps PostgreSQL custom creados antes de distintas fases financieras.
4. SQL/logs sueltos: smoke tests, concurrencia, manifiestos y resultados de ejecuciones locales y remotas históricas.

La base viva se persiste en el volumen Docker nombrado `supabase_db_ERP_BACKUP`, montado en `/var/lib/postgresql/data`. La carpeta host solo aporta configuración, snippets y secretos temporales como bind mounts; no aporta el directorio de datos PostgreSQL.

La carpeta **no es suficiente para reproducir el esquema actual**: no existe `C:\ERP_BACKUP\supabase\migrations`, no existe `seed.sql` y `schema_paths` está vacío. Sí conserva dumps capaces de restaurar estados históricos y un manifiesto de 13 migraciones aplicadas el 31/07/2026, pero las fases posteriores solo están representadas por snapshots binarios y por los SQL del proyecto principal.

### Clasificación resumida

- Proyecto Supabase CLI: **sí**.
- Carpeta Docker Compose manual: **no**; Compose es generado internamente por Supabase CLI.
- Backup: **sí**, con schema/data SQL y siete dumps custom.
- Copia de código ERP: **no detectada**.
- Conjunto de scripts: **sí**, limitado a SQL de smoke/concurrencia; no se encontraron `.ps1`, `.bat`, `.cmd`, `.sh`, `.js`, `.ts` o `.py` operativos fuera de artefactos `.temp` generados.
- Almacenamiento de datos: **backups sí; datos vivos no**.

## 2. Árbol relevante

```text
C:\ERP_BACKUP
├── supabase
│   ├── config.toml                         # configuración activa Supabase CLI
│   ├── snippets\                           # vacío; bind mount de Studio
│   ├── .branches\_current_branch           # metadato CLI
│   └── .temp\                              # generado; versiones, enlace y secretos
│       └── start-secrets\                  # sensible; contenido no inspeccionado
├── backups
│   ├── 20260731_114022
│   │   ├── schema.sql
│   │   ├── data.sql
│   │   └── roles.sql
│   ├── finance_pre_migration_20260731_140442
│   │   ├── database.dump
│   │   └── schema.sql
│   ├── phase1_local_20260803_123639\database.dump
│   ├── before_unlinked_roles_20260803_145041\database.dump
│   ├── before_credit_line_phase1a_20260804_103134\*.dump
│   ├── before_credit_line_phase1b_20260804_115148\*.dump
│   ├── before_credit_line_phase1b1_20260804_132603\*.dump
│   └── before_credit_line_planned_maturities_hardening_20260805_102052\*.dump
├── migration_logs
│   ├── 20260731_121005\*.sql.log
│   └── production_finance_20260731_140839
│       ├── manifest.txt
│       ├── *.sql.log
│       └── postgrest_reload.log
├── concurrency_test
│   ├── concurrency.sql
│   ├── session1.log
│   ├── session2.log
│   └── test_key.txt
├── smoke_individual_v5.sql
├── smoke_individual_v6.sql
├── smoke_linked_payment_v1.sql
├── smoke_linked_payment_v2.sql
├── runtime_contracts.txt
├── runtime_payment_tests*.txt
└── remote_*.txt                         # preflight, smoke, limpieza y post-migración históricos
```

Se encontraron 80 archivos con tamaño total aproximado de 195,7 MB. El mayor es `backups\20260731_114022\data.sql` (121,8 MB).

## 3. Configuración Docker

### Fuente de configuración

Archivo activo: `C:\ERP_BACKUP\supabase\config.toml`.

- `project_id = "ERP_BACKUP"`.
- API: `54321`.
- PostgreSQL: `54322`.
- Shadow DB: `54320`.
- Studio: `54323`.
- Mailpit: `54324`.
- Analytics: `54327`.
- Pooler configurado en `54329`, pero deshabilitado.
- PostgreSQL major: `17`.
- Migraciones CLI habilitadas, pero `schema_paths = []` y no existe carpeta `supabase/migrations`.
- Seed habilitada y declarada como `./seed.sql`, pero ese archivo no existe.
- Realtime, Storage, Auth, Edge Runtime y Analytics habilitados.
- Vector storage habilitado en configuración.

No se encontró `docker-compose.yml`, `docker-compose.yaml`, variante Compose ni `Dockerfile` en ningún nivel. Las etiquetas de contenedor indican proyecto Compose `ERP_BACKUP`, pero no conservan `working_dir` ni `config_files`; esto es coherente con un Compose temporal generado por Supabase CLI.

### Servicios e imágenes observados

| Servicio/contenedor | Imagen |
|---|---|
| `supabase_db_ERP_BACKUP` | `public.ecr.aws/supabase/postgres:17.6.1.084` |
| `supabase_kong_ERP_BACKUP` | `public.ecr.aws/supabase/kong:2.8.1` |
| `supabase_auth_ERP_BACKUP` | `public.ecr.aws/supabase/gotrue:v2.194.0` |
| `supabase_rest_ERP_BACKUP` | `public.ecr.aws/supabase/postgrest:v14.4` |
| `supabase_realtime_ERP_BACKUP` | `public.ecr.aws/supabase/realtime:v2.120.3` |
| `supabase_storage_ERP_BACKUP` | `public.ecr.aws/supabase/storage-api:v1.67.23` |
| `supabase_studio_ERP_BACKUP` | `public.ecr.aws/supabase/studio:2026.07.27-sha-cbb076d` |
| `supabase_pg_meta_ERP_BACKUP` | `public.ecr.aws/supabase/postgres-meta:v0.96.6` |
| `supabase_edge_runtime_ERP_BACKUP` | `public.ecr.aws/supabase/edge-runtime:v1.74.2` |
| `supabase_inbucket_ERP_BACKUP` | `public.ecr.aws/supabase/mailpit:v1.30.2` |
| `supabase_analytics_ERP_BACKUP` | `public.ecr.aws/supabase/logflare:1.47.1` |
| `supabase_vector_ERP_BACKUP` | `public.ecr.aws/supabase/vector:0.53.0-alpine` |

### Puertos publicados

| Destino | Host |
|---|---:|
| Kong/API `8000/tcp` | `54321` |
| PostgreSQL `5432/tcp` | `54322` |
| Studio `3000/tcp` | `54323` |
| Mailpit `8025/tcp` | `54324` |
| Analytics `4000/tcp` | `54327` |

### Volúmenes y bind mounts

| Contenedor | Tipo | Origen | Destino | Papel |
|---|---|---|---|---|
| DB | volume | `supabase_db_ERP_BACKUP` | `/var/lib/postgresql/data` | persistencia real PostgreSQL |
| Storage | volume | `supabase_storage_ERP_BACKUP` | `/mnt` | persistencia Storage |
| Studio | bind | `C:\ERP_BACKUP\supabase\snippets` | `/ERP_BACKUP/supabase/snippets` | snippets Studio |
| DB | bind RO | `C:\ERP_BACKUP\supabase\.temp\start-secrets\...\secret-0` | clave interna PostgreSQL | secreto generado; no inspeccionado |
| Kong | bind RO | tres archivos bajo `.temp\start-secrets` | configuración/certificados Kong | generado; no inspeccionado |
| Edge runtime | bind RO | `.temp\start-secrets\...\main\index.ts` | `/root/index.ts` | bootstrap generado |

No se observó bind mount de `C:\ERP_BACKUP\backups`, de `ERP_BI_IA\sql` ni de una carpeta `migrations` al contenedor activo.

## 4. Origen de la base PostgreSQL

### Estado vivo

El origen inmediato del estado vivo es el volumen Docker:

```text
supabase_db_ERP_BACKUP
  -> /var/lib/docker/volumes/supabase_db_ERP_BACKUP/_data
  -> /var/lib/postgresql/data dentro del contenedor
```

Por tanto, reiniciar el stack conserva el estado mientras no se elimine el volumen. El contenido actual no se reconstruye desde los archivos de `C:\ERP_BACKUP\supabase`, porque faltan migrations y seed.

### Evidencias históricas de formación del estado

1. Snapshot SQL completo del 31/07/2026 a las 11:42 (`schema.sql`, `data.sql`, `roles.sql`).
2. Snapshot pre-migración financiera a las 14:04 (`database.dump` y `schema.sql`).
3. Manifiesto que afirma haber aplicado 13 migraciones al entorno identificado como producción entre 14:08 y 14:09.
4. Dumps locales previos a obligaciones no vinculadas, fases de crédito y hardening de vencimientos hasta el 05/08.
5. SQL actuales del proyecto principal, algunos aplicados manualmente al volumen según nombres de los backups y el estado documentado en la auditoría principal.

No existe dentro de la carpeta un script único, historial Supabase o runbook que explique y reproduzca toda la secuencia desde cero.

## 5. SQL, migraciones, dumps y scripts relevantes

### Inventario por archivo/grupo

| Ruta absoluta | Tipo/finalidad probable | Estado | Arranque | Crea base/esquema | Contenido | Riesgo | Recomendación |
|---|---|---|---:|---:|---|---|---|
| `C:\ERP_BACKUP\supabase\config.toml` | configuración Supabase CLI | activo | sí | configura, no define negocio | infraestructura | medio | versionar una copia saneada en el proyecto |
| `C:\ERP_BACKUP\backups\20260731_114022\schema.sql` | schema snapshot | histórico | no | sí al restaurar | estructura | alto si se ejecuta sobre estado actual | archivar con checksum |
| `...\data.sql` | dump plain de datos | histórico | no | carga datos | datos | crítico: datos reales y sobrescritura/duplicados | proteger, cifrar y retener por política |
| `...\roles.sql` | roles/atributos | histórico | no | roles | estructura de seguridad | alto | archivar protegido |
| `...\finance_pre_migration_20260731_140442\schema.sql` | snapshot anterior a 13 migraciones | histórico | no | sí al restaurar | estructura | alto | archivar con manifiesto |
| siete archivos `*.dump` | dumps PostgreSQL custom (`PGDMP`) | históricos/checkpoints | no | estructura + datos previsiblemente | ambos | crítico si se restaura; contienen datos | archivar, cifrar, checksums y catálogo |
| `migration_logs\...\manifest.txt` | trazabilidad de aplicación y SHA-256 | histórico crítico | no | no | metadatos | alto por referencias remotas; valioso para auditoría | conservar protegido y redactar copia pública |
| `migration_logs\*.sql.log` | salida de psql | histórico | no | evidencia de DDL aplicado | logs | medio | archivar; no usar como migración |
| `smoke_individual_v5.sql` | prueba individual antigua | histórico | no | no; muta dentro de transacción | datos de prueba | medio; termina en rollback | archivar/ignorar para ejecución |
| `smoke_individual_v6.sql` | revisión posterior individual | histórico | no | no; rollback | datos de prueba | medio | migrar a tests versionados si sigue vigente |
| `smoke_linked_payment_v1.sql` | prueba de pago vinculado, con resultados fallidos históricos | histórico | no | no; rollback | datos de prueba | alto si se ejecuta sin revisar | archivar |
| `smoke_linked_payment_v2.sql` | revisión posterior vinculada | histórico | no | no; rollback | datos de prueba | medio | versionar como test solo si se sanea |
| `concurrency_test\concurrency.sql` | prueba concurrente | histórico/peligroso | no | no | datos | **alto**: termina en `COMMIT`, no rollback | archivar y no ejecutar contra datos reales |
| `remote_*.txt` | salidas de acciones/preflights/smokes remotos | histórico | no | no | evidencia y posiblemente datos | alto por datos/referencias remotas | archivar protegido, nunca fuente canónica |
| `runtime_contracts.txt` | captura extensa de contratos | histórico | no | no | metadatos de esquema | medio, puede quedar obsoleto | archivar con fecha/checksum |

### Contenido financiero de los snapshots

El snapshot `20260731_114022` contiene datos para:

- `finance_amazon_income_forecasts`
- `finance_cash_accounts`
- `finance_cash_movements`
- `finance_credit_lines`
- `finance_credit_line_repayment_groups`
- `finance_credit_line_movements`
- `finance_settings`
- `finance_supplier_payments`

El snapshot de esquema de las 14:04 contiene esas ocho tablas y RPC de disposiciones, amortizaciones y financiación de pagos. No contiene las once tablas posteriores que hoy existen en Docker:

- `finance_purchase_payment_batches`
- `finance_purchase_payment_allocations`
- `finance_credit_line_repayments`
- `finance_credit_line_legacy_regularizations`
- `finance_credit_line_legacy_regularization_items`
- `finance_credit_line_planned_maturities`
- las cinco tablas `finance_unlinked_obligation*`

Los dumps binarios posteriores pueden contener estados intermedios de esos objetos, pero no se inspeccionaron ejecutándolos ni restaurándolos. Sus nombres solo permiten inferir el checkpoint; no prueban su contenido detallado.

## 6. Comparación con el proyecto principal

### Presente en ambos e idéntico

El manifiesto `production_finance_20260731_140839\manifest.txt` conserva SHA-256 de 13 migraciones. Los 13 hashes coinciden exactamente con los archivos actuales bajo `ERP_BI_IA\sql\migrations`:

- `20260721_safe_order_proforma_versioning.sql`
- `20260721_supplier_payment_actual_fields.sql`
- `20260721_supplier_payment_mark_paid_rpc.sql`
- `20260721_supplier_payment_sync_plan_rpc.sql`
- `20260721_z_remove_order_fx_from_operational_flow.sql`
- `20260721_supplier_payment_t_atomic_pay_finance.sql`
- `20260722_linked_purchase_payment_batches.sql`
- `20260727_credit_line_maturities_phase1.sql`
- `20260728_harden_credit_line_maturity_execution.sql`
- `20260729_close_credit_line_runtime_invariants.sql`
- `20260730_serialize_credit_line_operation_identities.sql`
- `20260731_enforce_canonical_drawdown_source_identity.sql`
- `20260731_z_remove_obsolete_supplier_payment_financing_trigger.sql`

En `C:\ERP_BACKUP` no hay copias físicas de esos SQL, solo logs, nombres y hashes que apuntan a rutas relativas `sql/migrations/...` del proyecto principal.

### Presente en ambos pero diferente

No se encontró ningún archivo SQL independiente de `C:\ERP_BACKUP` con hash idéntico a otro SQL del proyecto. Los dos `schema.sql` son dumps monolíticos históricos y, por naturaleza, difieren de las migraciones incrementales.

Existe solapamiento semántico —mismas tablas/RPC financieras— entre snapshots y migraciones, pero no equivalencia de archivo. Ejecutar ambos como si fueran acumulativos duplicaría o reemplazaría objetos.

### Solo en `C:\ERP_BACKUP`

- Dumps `schema.sql`, `data.sql`, `roles.sql` y siete `*.dump`.
- SQL de smoke tests individuales/vinculados.
- SQL de concurrencia con commit.
- Resultados locales/remotos, runtime contracts y logs de migración.
- Configuración Supabase CLI y `.temp` generado.

Ninguno de estos archivos es una migración incremental canónica ausente del proyecto. Los smoke tests sí son artefactos únicos que podrían aportar cobertura histórica, pero no deben aplicarse como DDL.

### Solo en `ERP_BI_IA`

- La colección completa `sql/migrations`, incluidas las fases del 03–05/08.
- `sql/data/20260804_credit_line_planned_maturities.sql` con 33 vencimientos.
- Diagnósticos versionados de obligaciones, crédito, autorización, concurrencia y pagos.
- Todo el código TypeScript/API/UI financiero.

### Relación con los objetos reales documentados

| Capa | Tablas finance | Explicación |
|---|---:|---|
| Snapshot pre-migración 31/07 14:04 | 8 | estado histórico |
| Proyecto SQL actual | 19 definidas/referenciadas | fuente incremental más completa |
| Base Docker viva auditada | 19 | estado final actual |

La igualdad del número de tablas entre proyecto y Docker no prueba igualdad total de funciones, constraints o datos. La auditoría principal ya documentó ausencia de `supabase_migrations.schema_migrations`, por lo que los dumps/logs no cierran el historial automáticamente.

## 7. Elementos no reproducibles

1. El volumen `supabase_db_ERP_BACKUP` contiene el estado final, pero no hay historial integrado de migraciones de aplicación.
2. No hay carpeta `supabase/migrations`, `seed.sql` ni esquema declarativo en `C:\ERP_BACKUP`.
3. Los dumps del 03–05/08 son binarios; sin restauración aislada no se conoce su catálogo exacto.
4. No existe un manifiesto equivalente al del 31/07 para todas las fases posteriores.
5. Los 33 vencimientos previstos están en el proyecto principal y en la base viva, pero no en una seed/migration de `C:\ERP_BACKUP`.
6. La fila legacy pagada sin importes reales documentada en la auditoría principal procede del estado/datos; no existe una explicación canónica en migraciones.
7. Grants, RLS y versiones finales de 46 rutinas no pueden reconstruirse desde `C:\ERP_BACKUP` por sí sola.
8. Las acciones registradas en archivos `remote_*` evidencian cambios/limpiezas históricas fuera del flujo local, pero no constituyen un ledger migratorio reproducible.

## 8. Riesgos

### Scripts destructivos o mutadores

- Los dumps/schema contienen DDL, funciones con `DELETE` y cargas de datos; restaurarlos sobre una base existente es de riesgo crítico.
- `concurrency_test\concurrency.sql` llama una RPC mutadora y termina en `COMMIT`.
- Los smoke tests contienen operaciones reales aunque sus versiones inspeccionadas terminan en `ROLLBACK`; ejecutarlos depende de IDs concretos.
- Los archivos `remote_delete_*` muestran que hubo limpiezas remotas históricas. No son scripts ejecutables actuales, pero contienen evidencia sensible.

### Secretos y datos

- `.temp\start-secrets` contiene secretos generados y está físicamente dentro de `C:\ERP_BACKUP`; no debe versionarse ni copiarse a documentación.
- `data.sql` y los dumps contienen datos reales o copias de ellos; requieren cifrado, acceso restringido y retención formal.
- `manifest.txt` expone host, usuario, branch y commit remotos, aunque no una contraseña; debe considerarse metadata sensible.

### Reproducibilidad

- Persistencia principal en volumen Docker sin backup/checksum vinculado al estado actual.
- Backups múltiples sin catálogo central de alcance, origen, checksum y restauración verificada.
- Ausencia de migrations/seed local Supabase pese a tenerlas habilitadas en config.
- Dependencia de SQL del proyecto principal mediante rutas relativas y ejecuciones manuales.
- No hay Compose versionado; actualizar Supabase CLI puede cambiar el Compose generado y las versiones.

### Duplicados, históricos y no utilizados

- Cuatro revisiones de smoke tests y múltiples salidas de reintentos: históricos, no fuente canónica.
- Dos series de logs del mismo conjunto de migraciones: una local/operativa y otra etiquetada producción.
- `snippets` vacío.
- `.temp` es regenerable y debe ignorarse, salvo investigación puntual.
- Los snapshots SQL/dumps se solapan temporalmente; deben catalogarse, no mezclarse.

## 9. Recomendación de fuente de verdad

### Fuente canónica propuesta

1. **Código y migraciones:** `ERP_BI_IA\sql\migrations`, una vez reconciliadas y convertidas a una secuencia Supabase canónica con checksums.
2. **Infraestructura:** versionar en el proyecto una copia saneada de `supabase/config.toml`, sin `.temp` ni secretos.
3. **Baseline:** generar desde una base local reconciliada un baseline declarativo nuevo; no usar directamente los dumps históricos como migración.
4. **Datos/fixtures:** mantener seeds sintéticas y no sensibles en el proyecto; mantener backups reales fuera de Git, cifrados y catalogados.
5. **Documentación:** runbook de `supabase start`, creación desde cero, aplicación ordenada, validación y restauración en entorno desechable.

### Tratamiento de `C:\ERP_BACKUP`

- `supabase/config.toml`: versionar saneado.
- `.temp`: ignorar y proteger.
- backups/dumps/data: archivar fuera de Git con cifrado/checksums.
- logs/manifiestos: archivar como evidencia; no ejecutar.
- smoke SQL: revisar y trasladar solo las versiones válidas al árbol de tests del proyecto.
- `concurrency.sql`: archivar como peligroso o convertirlo a rollback antes de cualquier reutilización futura.

## 10. Veredicto

Clasificación:

- **ERP_BACKUP solo contiene infraestructura:** no.
- **ERP_BACKUP contiene migraciones necesarias:** no como archivos incrementales; contiene snapshots y evidencia de migraciones, pero las migraciones canónicas están en el proyecto principal.
- **ERP_BACKUP contiene una fuente de verdad distinta:** sí, como estado histórico/dumps y volumen vivo, no como fuente deseable.
- **ERP_BACKUP contiene datos/estado no reproducible:** sí.
- **Se necesita reconciliación antes del baseline:** sí, obligatoriamente.

La inspección cambia el dictamen solo en precisión, no en dirección. Ahora se sabe que existe trazabilidad fuerte para 13 migraciones del 31/07 —hashes idénticos a los SQL actuales— y que hay checkpoints antes de fases posteriores. Sin embargo, confirma que la base actual depende de un volumen persistente y de aplicaciones manuales sin un ledger completo. Por tanto, el módulo sigue **no preparado para migración remota**.

## 11. Siguiente paso mínimo recomendado

Sin tocar la base viva:

1. Crear un inventario/checksum de los dumps y vincular cada uno a la fase exacta.
2. Preparar en el proyecto principal una secuencia canónica de migraciones, incluyendo las posteriores al manifiesto del 31/07.
3. Crear una base Docker desechable nueva y reconstruirla exclusivamente desde esa secuencia más fixtures sintéticas.
4. Comparar estáticamente/esquemáticamente esa reconstrucción con `supabase_db_ERP_BACKUP`.

No debe generarse todavía el baseline definitivo desde un dump histórico ni restaurarse nada sobre la base actual.
