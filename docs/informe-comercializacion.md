# Informe de estado y plan de comercialización

**Producto:** CRM inmobiliario mkgenia
**Fecha:** 13 de agosto de 2026
**Autor:** Josep Orriols

---

## 1. Resumen ejecutivo

El sistema desarrollado para Grupo Hogares es hoy una herramienta interna
completa y en producción: 7 módulos operativos, ~13.700 líneas de código, y un
valorador de inmuebles con datos reales de mercado que no tiene equivalente
directo entre los CRM inmobiliarios del mercado español.

La conclusión de este informe es que **el producto comercializable no es el CRM,
es el valorador**. Un CRM inmobiliario genérico compite con Inmovilla, Witei u
Optima en un mercado maduro y a precios de 50–80 €/mes. El valorador —mapa de
precios por barrio, comparables por semejanza e informe PDF para el
propietario— es el elemento diferencial y el que justifica una tarifa de 300 €
o más.

Para llegar a venderlo hay tres bloques de trabajo:

1. **Convertir el sistema en multi-agencia.** Hoy está construido para un único
   cliente: no existe el concepto de agencia en la base de datos y la seguridad
   por filas está desactivada. Es el único bloqueante técnico real.
2. **Resolver la capa de CRM sin construirla.** La vía recomendada es integrar
   GoHighLevel como plataforma base (contactos, WhatsApp oficial, landing
   pages, facturación y sub-cuentas) y mantener en propiedad únicamente el
   valorador y los datos de mercado.
3. **Validar comercialmente antes de invertir.** El valorador ya funciona. Se
   puede vender como servicio manual desde el primer día, sin escribir una
   línea de código adicional.

**Estimación de plazos:** ~11 semanas de desarrollo hasta un producto vendible a
múltiples clientes. **Punto de equilibrio:** 2 clientes.

---

## 2. Estado actual del sistema

### 2.1. Alcance funcional

| Módulo | Estado | Descripción |
|---|---|---|
| **Valorador** | Operativo | Mapa coroplético de los 88 barrios de Valencia, valoración por punto + radio, comparables por semejanza ponderada, informe PDF de 2 hojas descargable |
| **Captaciones** | Operativo | Pipeline de estados, mapa de zonas con dibujo de polígonos, envío de WhatsApp, agenda, papelera |
| **Demandas** | Operativo | Ingesta automática por webhook desde portales, cualificación automatizada |
| **Mensajes** | Operativo | Bandeja de WhatsApp con soporte multi-instancia |
| **Leads** | Operativo | Gestión de contactos, estados y notas |
| **Equipo** | Operativo | Invitación de usuarios, roles Administrador / Agente, permisos por módulo |
| **Configuración** | Operativo | Perfil, tema claro/oscuro, estado de conexión de WhatsApp |

### 2.2. Arquitectura técnica

- **Frontend / backend:** Next.js 16 (App Router), React 19, TypeScript,
  Tailwind v4, shadcn/ui sobre Base UI.
- **Base de datos y autenticación:** Supabase (plan gratuito).
- **Automatización:** n8n, alojado en el mismo servidor.
- **Datos de mercado:** scraper de Idealista vía Apify, orquestado desde n8n.
- **Mensajería:** Evolution API (WhatsApp no oficial).
- **Cartografía:** Leaflet + geojson oficial de los 88 barrios de Valencia,
  geocodificación con CartoCiudad y consulta de Catastro (DNPLOC).

### 2.3. Infraestructura y coste actual

| Concepto | Proveedor | Coste |
|---|---|---|
| VPS con EasyPanel (CRM + n8n) | Hostinger | 7 €/mes |
| Base de datos, autenticación y almacenamiento | Supabase (plan gratuito) | 0 € |
| Scraping de mercado | Apify | variable |
| **Total** | | **~7 €/mes** |

El coste actual es mínimo porque el sistema sirve a un solo cliente y se apoya
en planes gratuitos.

### 2.4. Métricas

- ~13.700 líneas de TypeScript / TSX.
- 7 módulos funcionales, 3 endpoints de API, ~15 componentes de interfaz.
- 88 barrios de Valencia cartografiados.
- Base de datos de mercado con decenas de miles de anuncios históricos.

---

## 3. Diagnóstico: qué impide vender el sistema hoy

### 3.1. El sistema es mono-inquilino

No se trata de un ajuste menor. El sistema está construido para servir a una
única agencia:

- **No existe el concepto de agencia en la base de datos.** Ni `perfiles`, ni
  `leads`, ni `captaciones`, ni `valoraciones` tienen un campo que identifique
  a qué cliente pertenece cada registro. Cualquier usuario nuevo vería los datos
  de todos los demás.
- **La seguridad por filas (RLS) está desactivada** en todas las tablas, de
  forma deliberada y documentada. La mayoría de las operaciones de servidor
  usan la clave de servicio, que se salta cualquier política de acceso. En un
  entorno de cliente único es una decisión pragmática; con varios clientes es
  una fuga de datos desde el primer día.
- **Hay valores fijos en el código** que deberían ser configuración por
  cliente: el nombre comercial y la plantilla del mensaje de WhatsApp, el
  nombre del agente, la lista de instancias de mensajería y el identificador de
  instancia de Evolution API.

### 3.2. El producto solo funciona en Valencia

El fichero de barrios es un recurso estático (`public/valencia-barrios.geojson`)
y el scraper está configurado para una sola ciudad. Sin desacoplar la geografía,
el mercado direccionable se limita a las agencias de Valencia.

### 3.3. La lógica de negocio vive fuera del repositorio

Una parte sustancial del sistema —el scraping, la detección de bajas y de
cambios de precio, la cualificación de demandas— reside en flujos de n8n
exportados como ficheros JSON, con credenciales incluidas. No están bajo control
de versiones y no se pueden replicar por cliente sin duplicarlos manualmente.

### 3.4. Los límites del plan gratuito de Supabase están cerca

El plan gratuito ofrece 500 MB de base de datos y **1 GB de almacenamiento**, y
el proyecto se suspende por inactividad. Como las imágenes de Idealista caducan
en unas 24 horas, el sistema archiva copias permanentes en el almacenamiento
(hasta 150 por ejecución). Ese límite se agotará con un solo cliente en pocos
meses. Es la primera restricción que se alcanzará, antes que cualquier otra.

---

## 4. Riesgos que deben resolverse antes de facturar

| Riesgo | Nivel | Descripción y mitigación |
|---|---|---|
| **Scraping de Idealista** | Alto | Sus condiciones de uso lo prohíben. Mientras el uso es interno el riesgo es limitado; al cobrar por un producto cuyo núcleo son esos datos, la exposición cambia de naturaleza. Requiere consulta jurídica previa. Alternativas legítimas: Colegio de Registradores, INE, Catastro. |
| **Protección de datos (RGPD)** | Alto | Al tratar datos de propietarios y compradores de terceros, la empresa pasa a ser **encargada del tratamiento**. Es obligatorio un contrato de encargo con cada cliente, registro de actividades y política de retención. |
| **WhatsApp no oficial** | Medio-alto | Evolution API opera fuera de los canales autorizados por Meta; los bloqueos de número son frecuentes. Si se vende como funcionalidad, debe migrarse a la API oficial (ver sección 6). |
| **Dependencia de proveedor** | Medio | Si se adopta GoHighLevel, cambios de precio, condiciones o disponibilidad afectan al negocio completo. Se mitiga manteniendo en propiedad los datos de mercado y el valorador. |
| **Informe de valoración** | Bajo | Ya incluye la advertencia de que no constituye una tasación conforme a la Orden ECO/805/2003. Debe mantenerse y reforzarse. |

---

## 5. La decisión estratégica: construir o integrar

Existen dos caminos para convertir el sistema en un producto vendible.

### Opción A — Desarrollo propio completo

Añadir al CRM actual la multi-agencia, la facturación con Stripe, las landing
pages de captación y mantener la mensajería propia.

- **A favor:** control total, sin coste fijo de plataforma, sin dependencia de
  terceros.
- **En contra:** 4–6 semanas adicionales de desarrollo, el riesgo de WhatsApp no
  se resuelve, y hay que construir y mantener funcionalidades que son
  commodities (email, landing pages, calendarios, facturación).

### Opción B — Integración con GoHighLevel *(recomendada)*

Usar GoHighLevel como plataforma base y mantener en propiedad únicamente el
valorador y los datos de mercado.

- **A favor:**
  - **WhatsApp oficial** a través de la API Cloud de Meta, vía LeadConnector.
    Elimina por completo el riesgo de bloqueo de número.
  - **Multi-agencia resuelta**: cada cliente es una sub-cuenta.
  - **Facturación y marca blanca incluidas**, con reventa de consumo (teléfono,
    email, WhatsApp, IA) aplicando margen propio.
  - Landing pages, formularios, email, SMS, calendarios y redes sociales sin
    desarrollo ni mantenimiento.
- **En contra:**
  - Coste fijo desde el primer mes.
  - Se descarta parte del CRM ya construido (leads, mensajes, equipo,
    permisos).
  - Dependencia de un proveedor externo.
  - Documentación, soporte y ecosistema en inglés.

### 5.1. Limitación técnica que condiciona el diseño

GoHighLevel **no puede alojar los datos de mercado**. Sus objetos
personalizados están limitados a 10 por sub-cuenta, con topes de campos y
registros, y no están concebidos para conjuntos de datos de cientos de miles de
filas. Su API admite 100 peticiones cada 10 segundos.

La tabla de mercado contiene decenas de miles de anuncios con precio por metro
cuadrado calculado, medianas y percentiles por barrio, geometrías de 88 barrios
y consultas por punto y radio. Nada de eso es viable en GoHighLevel, como
tampoco el mapa, el motor de semejanza ni el informe PDF.

**Conclusión:** GoHighLevel nunca sustituye al valorador. Sustituye al CRM que
lo rodea. Esa es precisamente la división correcta: se alquila la parte
commodity y se construye solo el elemento diferencial.

---

## 6. Arquitectura objetivo

| Capa | Responsable |
|---|---|
| Contactos, pipelines de venta | GoHighLevel |
| WhatsApp oficial, email, SMS, calendarios | GoHighLevel |
| Landing pages, formularios de captación, redes sociales | GoHighLevel |
| Sub-cuentas (una por agencia), marca blanca | GoHighLevel |
| Facturación y reventa de consumo | GoHighLevel |
| Datos de mercado, estadísticas por barrio, histórico de valoraciones | Supabase (propio) |
| Scraping y automatizaciones | n8n + Apify (propio) |
| Mapa, motor de comparables, informe PDF | Aplicación propia |

La integración se realiza mediante la **API v2 de GoHighLevel con OAuth 2.0** y
un enlace de menú personalizado que embebe el valorador dentro de la interfaz de
cada sub-cuenta.

---

## 7. Plan de ejecución

### Fase 0 — Validación comercial *(semanas 1–4, sin desarrollo)*

Vender el valorador en su estado actual como servicio a 3–5 agencias de
Valencia, generando los informes manualmente, a 200–300 €/mes.

**Objetivo:** confirmar que existe disposición a pagar antes de invertir en
desarrollo. Si nadie paga, se evitan tres meses de trabajo. Si pagan, son los
primeros clientes del producto.

### Fase 1 — Valorador multi-agencia *(semanas 3–6, ~3 semanas)*

- Tabla de agencias e identificador de agencia en las tablas del valorador.
- Activación de RLS con políticas por agencia.
- Sustitución de la clave de servicio por acceso autenticado en las lecturas.
- Extracción a configuración de todos los valores fijos en código.

### Fase 2 — Integración con GoHighLevel *(semanas 6–9, ~3 semanas)*

- Aplicación OAuth 2.0 contra la API v2.
- Embebido del valorador mediante enlace de menú personalizado.
- Sincronización de contactos y valoraciones con las sub-cuentas.
- Migración de la mensajería a WhatsApp oficial.

### Fase 3 — Parametrización de las automatizaciones *(semanas 9–11, ~2 semanas)*

Sustituir los flujos duplicados por flujos únicos que recorran las agencias
activas leyendo su configuración desde la base de datos. Incorporación de los
flujos al control de versiones y retirada de las credenciales del código.

### Fase 4 — Expansión geográfica *(a partir del mes 4)*

Sustituir el fichero estático de barrios por una tabla de zonas con geometrías
por ciudad, y parametrizar el scraper. Es el requisito para vender fuera de
Valencia.

**Plazo total hasta producto vendible a múltiples clientes: ~11 semanas.**

---

## 8. Modelo económico

### 8.1. Tarifas propuestas

| Plan | Precio | Contenido |
|---|---|---|
| Básico | 149 €/mes | CRM, leads y captaciones. Sin valorador. |
| **Pro** | **349 €/mes** | Todo lo anterior + valorador con informes limitados + WhatsApp |
| Agencia | 699 €/mes | Multi-oficina, informes ilimitados, marca blanca en el informe |

Adicionalmente, **implantación inicial de 500–1.500 €** por cliente (alta de
ciudad, configuración del scraper y formación), que cubre el coste real de
puesta en marcha.

### 8.2. Estructura de costes *(estimación)*

| Concepto | Coste mensual |
|---|---|
| GoHighLevel (plan Unlimited) | ~275 € |
| VPS Hostinger KVM 4 (16 GB) | ~15 € |
| Supabase Pro | ~23 € |
| Apify — scraping de Valencia | ~40 € |
| **Coste fijo total** | **~353 €** |
| WhatsApp, por cliente | ~9 € + consumo de Meta |

### 8.3. Punto de equilibrio

Con el plan Pro a 349 €/mes:

| Clientes | Ingresos | Costes | Resultado |
|---|---|---|---|
| 1 | 349 € | 362 € | −13 € |
| **2** | **698 €** | **371 €** | **+327 €** |
| 5 | 1.745 € | 398 € | +1.347 € |
| 10 | 3.490 € | 443 € | +3.047 € |

**El negocio es rentable a partir del segundo cliente.**

### 8.4. Recomendación sobre el plan de GoHighLevel

Empezar con el plan **Unlimited (297 $/mes)**, no con el plan SaaS Pro
(497 $/mes). El Unlimited ya incluye sub-cuentas ilimitadas, marca blanca y
acceso completo a la API, que es lo que la integración necesita. El salto a SaaS
Pro aporta facturación automática y aprovisionamiento de sub-cuentas, que con
menos de 8–10 clientes no compensa. Son **200 $/mes de ahorro** en la etapa de
menores ingresos.

Ninguna suscripción debería contratarse antes de tener firmado el primer
cliente.

---

## 9. Ventaja competitiva estructural

El coste del scraping escala **por ciudad, no por cliente**. Dos agencias de
Valencia comparten exactamente la misma base de datos de mercado y las mismas
ejecuciones de Apify. El décimo cliente en Valencia tiene un coste marginal de
infraestructura prácticamente nulo.

Esto tiene una consecuencia comercial directa: **conviene saturar Valencia antes
de abrir una segunda ciudad.** Cada ciudad nueva añade coste fijo; cada cliente
nuevo en una ciudad ya cubierta es margen casi puro.

---

## 10. Próximos 30 días

1. Consulta jurídica sobre el uso comercial de los datos de mercado y sobre las
   obligaciones como encargado del tratamiento.
2. Contactar con 5 agencias de Valencia y ofrecer el valorador como servicio a
   250 €/mes.
3. Preparar el material comercial: informe de valoración de ejemplo y
   demostración del mapa.
4. Migrar Supabase al plan Pro antes de agotar el almacenamiento.
5. No contratar GoHighLevel ni iniciar desarrollo hasta cerrar el primer cliente.

---

## Notas sobre este informe

Las cifras de coste e ingresos son estimaciones basadas en las tarifas públicas
de los proveedores en agosto de 2026 y deben validarse antes de tomar decisiones
de inversión. Los plazos de desarrollo son estimaciones sobre el estado del
código a esta fecha.

**Fuentes consultadas:** tarifas y documentación de GoHighLevel (planes, API v2
con OAuth 2.0, objetos personalizados, integración de WhatsApp vía
LeadConnector), documentación de autoalojamiento de Supabase, y tarifas
públicas de VPS de Hostinger.
