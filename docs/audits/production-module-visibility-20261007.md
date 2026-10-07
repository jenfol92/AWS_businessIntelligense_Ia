# Visibilidad del primer deployment — implementación local

## Checkpoint y alcance

Rama: `feature/finance-forecast`. HEAD inicial: `b81890ca`. Estado inicial completo en `outputs/production-visibility/checkpoint-status.txt` y `checkpoint-stat.txt`.

La tarea conserva todos los cambios anteriores. La comparación SHA-256 de 1.606 archivos preexistentes detectó únicamente cuatro archivos modificados por esta tarea: middleware, Sidebar, DashboardBI y la página Pedidos. `vercel.json`, APIs, repositorios, resolvers, pipelines y lógica de negocio conservan sus bytes iniciales.

## Rutas reales bloqueadas

Todas admiten prefijos `/es` y `/en`. También se bloquea la entrada sin locale antes de su redirección.

| Módulo | Páginas actuales | Cobertura |
| --- | --- | --- |
| Inventario | `/inventario` | Todas sus subrutas; stock por país y forecast están dentro de su UI, sin páginas independientes actuales |
| Productos | `/productos`, `/productos/new`, `/productos/[id]`, `/productos/[id]/edit` | Todo el árbol, incluyendo auxiliares futuras |
| Planner | `/planificador`, `/planificador/llegadas`, `/planificador/anual`, `/planificador/logistica` | Todo el árbol |
| Sugerencias | `/pedidos/sugeridos` | Todo el árbol; pestaña y basket de sugerencias en `/pedidos` ocultos |

La allowlist conserva Dashboard, login, Pedidos normales, Proveedores, Logística, Finanzas (incluida planificación financiera), COO, Amazon Envíos y Cumplimiento. Una nueva ruta de página fuera de los árboles permitidos requiere exposición explícita. Las rutas API están excluidas de esta política.

## Implementación y navegación

`config/productionExposure.ts` es la única política. En `NODE_ENV=development` devuelve la navegación original sin modificarla y permite todas las páginas. En production filtra recursivamente entradas y elimina agrupadores vacíos.

Sidebar: desaparecen Inventario, Productos y todo el grupo Planificador (Resumen, Llegadas, Planificador anual y Calendario logístico). No existían entradas independientes de forecast, stock por país o sugerencias.

Dashboard: se ocultan “Abrir inventario” y “Planificar reposición”. Se conservan datos y cálculos de las tablas, y el enlace a planificación financiera.

Pedidos: se ocultan únicamente pestaña, contenido y basket de sugerencias. No cambian hooks, consultas, creación/edición/confirmación de órdenes ni lógica de cálculo.

Los restantes enlaces a productos encontrados están dentro de Inventario o Productos, ambos bloqueados. No se encontraron accesos adicionales desde Finance o Logística.

Middleware responde 404 antes del trabajo de locale/autenticación para páginas no expuestas. Cuatro layouts server-side llaman a `notFound()` y cubren los árboles completos, incluso rutas con puntos que el matcher existente del middleware omite. No dependen de JavaScript cliente.

## APIs analizadas

No se modifica ni bloquea ninguna API. La autorización y el backend existentes conservan sus owners; esta política es exclusivamente de páginas/UI.

| Clase | APIs/familias | Evidencia y decisión |
| --- | --- | --- |
| A: consumidores UI bloqueada identificados | `/api/products/catalog`, `/catalog/options`, `/api/products/[id]/form`, `/api/products/amazon-marketplaces`, `/api/products/[id]/documentos/**`, `/api/products/[id]/benchmarking/**` | Clientes de catálogo, formulario, documentos y benchmarking en `modules/products/services`; preservadas en esta tarea |
| A: consumidores UI bloqueada identificados | `/api/inventory/products-lite`, `/api/inventory/lotes`, `/api/inventory/product/[id]`, `/forecast`, `/sales-by-country/**`, `/api/inventory/products/[productId]/country-price-distribution` | InventoryPage e inventoryDetailClient; preservadas |
| A: consumidores UI bloqueada identificados | `/api/planner/arrivals`, `/api/planner/destinations`, `/api/planning/logistics-calendar`, `/api/planning/products/[productId]/supply-config`, `/forecast` | Planner clients/hooks y ProductSupplyConfigForm/ProductBenchmarkClient; preservadas |
| B: compartidas | `/api/inventory/comparison` | DashboardBI e InventoryPage; permanece disponible |
| B: compartidas | `/api/planner/summary`, `/api/orders/suggestions` | useOrderSuggestions de Pedidos reutiliza plannerClient; permanecen disponibles |
| B: interna necesaria | `/api/orders/products-search` y resto de Orders | Selección de productos y operaciones normales de órdenes; permanecen disponibles |
| C: no se acredita exclusividad | `/api/products`, `/api/products/[id]`, `/variants`, `/simulate`, `/costes-lotes`, `/api/products/full`, `/api/inventory/amazon-canonical`, `/api/inventory/product/[id]/annual-forecast`, `/api/planner/analyze`, `/api/planning/analyze`, `/api/orders/create-from-planner`, `/planner-preview`, `/lead-time-suggestions` | CRUD/utilidades/operaciones cuyo cierre requiere revisión de consumidores; sin cambios |

Las referencias anteriores describen consumidores encontrados, no prueban ausencia de consumidores externos. No se bloquea automáticamente ningún endpoint por contener “product” o “inventory”. El acceso interno a `productos`, ASIN, SKU y aliases permanece intacto.

## Archivos de implementación

Modificados: `middleware.ts`, `shared/layout/Sidebar.tsx`, `modules/dashboard/components/DashboardBI.tsx`, `app/[locale]/(dashboard)/pedidos/page.tsx`.

Creados: `config/productionExposure.ts`, `server/productionPageGuard.ts`, cuatro `layout.tsx` en Inventario, Productos, Planificador y Pedidos/Sugeridos, y `config/productionExposure.test.mjs`.

Documentación/evidencias locales: este informe y `outputs/production-visibility/` (checkpoint, hashes, configuración focal ESLint, script de verificación, diff de esta tarea y estado final). No forman parte de lógica de runtime.

## Validación

- 20/20 tests focales: desarrollo/producción, locales, detalle/edición/subrutas, Sidebar real renderizado, agrupadores, allowlist, API internas, middleware real con dependencias offline y cuatro layouts reales con `notFound()` simulado.
- `npx.cmd tsc --noEmit --incremental false`: PASS.
- ESLint focal de los 11 archivos de código/test: PASS, cero errores/warnings. Configuración aislada en outputs porque no hay configuración raíz.
- Advertencia del runner Node: package.json no declara tipo de módulo; no se cambia package.json.
- `git diff --check` global detecta whitespace previo en `modules/inventory/components/InventoryPage.tsx:713`. Archivo intacto respecto al checkpoint. No se arregla trabajo ajeno.
- Comparación de los 1.606 hashes: cero modificaciones inesperadas.

## Límites y siguiente validación

No se ha probado un deployment Vercel ni navegación E2E en un servidor production real. Las pruebas son locales/offline de política, render Sidebar y owners server-side. `next start` local también utiliza production y aplicará el bloqueo; `next dev` conserva acceso completo.

Las APIs permanecen disponibles según su autorización actual: ocultar/bloquear páginas no equivale a deshabilitar el backend. Esta tarea no pretende introducir permisos de API. Futuras páginas dentro de árboles permitidos heredan exposición; una futura UI sensible allí debe añadirse explícitamente a la política y al guard.

Sin deployment, sin cambios de vercel.json/crons, sin llamadas Amazon, migraciones, Supabase ni datos. Sin cambios de lógica Orders, inventario, Finance, forecast, planner o identidad. STOP.
