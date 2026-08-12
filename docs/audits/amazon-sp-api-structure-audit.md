# Amazon SP-API Structure Audit

Fecha: 2026-07-13

Alcance: auditoria pequena de `modules/amazon-sp-api` sin mover archivos, sin refactor masivo y sin romper imports existentes.

## 1. Estructura actual

`modules/amazon-sp-api` es un modulo plano. Todos los archivos conviven en el mismo nivel:

- Clientes/API: `spApiClient.ts`, `reportsClient.ts`, `lwaClient.ts`, `signing.ts`, `config.ts`, `errors.ts`.
- Scheduler y jobs: `amazonReportSchedulerService.ts`, `amazonReportSchedulerRepository.ts`, `amazonReportSchedulerTypes.ts`, `reportJobsRepository.ts`.
- Servicios de informes e importacion: `fbaForecastSpApiImportsService.ts`, `fbaCountryReportService.ts`, `fbaMyiInventoryReportDiagnosticService.ts`.
- Servicios de inbound/logistica: `syncInboundShipmentsToAmazonEnviosService.ts`, `amazonInboundShipmentLogisticsService.ts`, `linkInboundShipmentContainerService.ts`, `linkInboundShipmentOrderService.ts`, `resolveAmazonInboundLogisticsFlow.ts`, `resolveAmazonShipmentVisibleLogistics.ts`.
- Diagnosticos: `amazonInboundShipmentEnrichmentDiagnosticService.ts`, `inboundShipmentsDiagnosticService.ts`, `vendorShipmentDetailsDiagnosticService.ts`.
- Parsers, mappers y utilidades: `spApiReportImportUtils.ts`, `skuProductMatching.ts`, `types.ts`.

No hay subcarpetas internas como `clients`, `services`, `repositories`, `parsers`, `mappers`, `types` o `utils`.

## 2. Archivos que mezclan responsabilidades

- `fbaForecastSpApiImportsService.ts`: solicita reports, descarga documentos, parsea filas, normaliza columnas, resuelve productos, escribe raw FBA, sincroniza `ventas_diarias` y contiene importadores de inventario/ledger.
- `amazonReportSchedulerService.ts`: coordina planificacion, reglas de ejecucion, llamadas a SP-API y actualizacion de estado.
- `syncInboundShipmentsToAmazonEnviosService.ts`: combina lectura de informes, transformacion, reglas de negocio y persistencia.
- `skuProductMatching.ts`: normaliza SKU y hace lookup contra productos; podria quedar como mapper/resolver dedicado.

## 3. Archivos client/API

- `spApiClient.ts`: cliente HTTP firmado para SP-API.
- `reportsClient.ts`: operaciones de reports sobre SP-API.
- `lwaClient.ts`: autenticacion LWA.
- `signing.ts`: firma AWS SigV4.
- `config.ts`: carga de configuracion SP-API.
- `errors.ts`: mapeo comun de errores.

## 4. Archivos services

- `fbaForecastSpApiImportsService.ts`
- `fbaCountryReportService.ts`
- `fbaMyiInventoryReportDiagnosticService.ts`
- `amazonReportSchedulerService.ts`
- `syncInboundShipmentsToAmazonEnviosService.ts`
- `amazonInboundShipmentLogisticsService.ts`
- `linkInboundShipmentContainerService.ts`
- `linkInboundShipmentOrderService.ts`
- `resolveAmazonInboundLogisticsFlow.ts`
- `resolveAmazonShipmentVisibleLogistics.ts`

## 5. Archivos repositories

- `amazonReportSchedulerRepository.ts`
- `reportJobsRepository.ts`

Tambien hay persistencia directa dentro de servicios, especialmente en `fbaForecastSpApiImportsService.ts` y `syncInboundShipmentsToAmazonEnviosService.ts`.

## 6. Archivos parsers/mappers

- `spApiReportImportUtils.ts`: parseo de informes, fechas, numeros y hashing.
- `skuProductMatching.ts`: normalizacion SKU y matching de producto.
- Partes de `fbaForecastSpApiImportsService.ts`: normalizacion de FBA Sales, construccion de fingerprint y mapeo a `amazon_fba_sales_daily_raw`.
- Partes de `syncInboundShipmentsToAmazonEnviosService.ts`: mapeo de inbound shipments a estructuras internas.

## 7. Archivos utils

- `spApiReportImportUtils.ts`
- `config.ts`
- `errors.ts`
- `signing.ts`

## 8. Propuesta de estructura futura

Propuesta objetivo, sin mover archivos en esta tarea:

```text
modules/amazon-sp-api/
  clients/
    spApiClient.ts
    reportsClient.ts
    lwaClient.ts
    signing.ts
  config/
    config.ts
  repositories/
    amazonReportSchedulerRepository.ts
    reportJobsRepository.ts
    fbaSalesRepository.ts
    inboundShipmentsRepository.ts
  services/
    reports/
      amazonReportSchedulerService.ts
    sales/
      fbaSalesImportService.ts
      fbaSalesSyncService.ts
    inventory/
      fbaCountryReportService.ts
      fbaLedgerImportService.ts
    inbound/
      syncInboundShipmentsToAmazonEnviosService.ts
      amazonInboundShipmentLogisticsService.ts
  parsers/
    spApiReportImportUtils.ts
    fbaSalesReportParser.ts
    fbaInventoryReportParser.ts
  mappers/
    skuProductMatching.ts
    fbaSalesRawMapper.ts
    inboundShipmentMapper.ts
  types/
    types.ts
    amazonReportSchedulerTypes.ts
```

## 9. Riesgos de refactor

- Romper imports de rutas API y cron existentes.
- Cambiar sin querer el grano de deduplicacion de FBA Sales.
- Mezclar fuentes historicas con el source operativo `spapi_fba_customer_shipment_sales`.
- Reintroducir el report antiguo `GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA`.
- Mover persistencia sin cubrir casos de permisos/RLS y `supabaseAdmin`.
- Cambiar comportamiento de Forecast, Inventory, Stockagile o All Orders fuera de fase.

## 10. Plan por fases

Fase A: solo documentacion y estabilizar FBA Sales.

- Mantener imports existentes.
- Crear endpoint cron dedicado.
- Mantener el source interno `spapi_fba_customer_shipment_sales`.
- Usar solo `GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL` para FBA Sales.

Fase B: extraer parsers/mappers.

- Extraer parser de Amazon Fulfilled Shipments.
- Extraer mapper a `amazon_fba_sales_daily_raw`.
- Mantener tests o diagnosticos SQL alrededor del pedido `403-8390691-6119533`.

Fase C: separar repositories.

- Extraer lecturas/escrituras raw FBA.
- Extraer sync a `ventas_diarias`.
- Mantener `supabaseAdmin` solo en server-side interno.

Fase D: separar services por dominio.

- `reports`: request/poll/download.
- `inventory`: FBA Country, MYI, ledger.
- `sales`: FBA Sales raw y sync.
- `inbound`: envios, contenedores y logistica.

## 11. Sin refactor masivo

Esta auditoria no mueve archivos ni cambia imports. Solo documenta la situacion actual y propone una secuencia futura.

## 12. Compatibilidad

Los imports existentes deben seguir funcionando hasta que cada fase tenga validacion propia con `npx.cmd tsc --noEmit` y `npm.cmd run build`.
