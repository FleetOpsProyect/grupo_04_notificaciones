# Estado de implementación del arquetipo de Notificaciones (Fase D)

> **Documento histórico (Fase D original, Kafka y contratos en español).**  
> El estado vigente del arquetipo, con la migración a SNS/SQS y los contratos del DAS 1.1, está en
> [`changelog-arquetipo-sqs-sns.md`](./changelog-arquetipo-sqs-sns.md).  
> Este documento se conserva como evidencia de la primera implementación y **no debe usarse como referencia de contratos actuales**.

## Actualización vigente (2026-10-29)

- Broker: **Amazon SNS + SQS FIFO** (Kafka queda como modo alterno hasta la Fase 11).
- Sobre estándar en inglés: `event_id, event_type, version, occurred_at, source, correlation_id, data`.
- 7 handlers con aviso, incluidos incidente leve/grave y combustible.
- API en inglés sin prefijo: `/notifications`, `/notifications/status`, `/notifications/{id}`, `/notifications/{id}/acknowledgement`.
- Estados: `delivery_status` (`PENDING|SENT|FAILED`) y `acknowledgement_status` (`PENDING|ACKNOWLEDGED`).
- Outbox operativo hacia `fleetops_notification_events` con 4 eventos `notification_*_event`.
- `processed_events` con `expires_at` (TTL 30 días).
- 189 pruebas pasando y lint limpio al 2026-10-29.
- Consumidor SQS con visibilidad 2/10/30 s, `maxReceiveCount=4` y DLQ con `error_reason`/`receive_count`.

**Fecha de corte:** 2026-10-25  
**Alcance:** `notification-service/`  
**Estado general:** arquetipo funcional mínimo implementado. Firestore real, Kafka local, flujo `evento -> Firestore -> scheduler -> correo console` y los 8 índices compuestos validados. Resend validado con servidor HTTP controlado; no se hizo envío real. No desplegado.

## 1. Resumen ejecutivo

Se implementó el microservicio de Notificaciones de FleetOps sobre una arquitectura hexagonal en Node.js/CommonJS. El servicio cubre:

- Creación manual de alertas y notificaciones.
- Consumo de eventos de dominio desde Kafka.
- Persistencia transaccional en Firestore.
- Despacho de correos con reintentos, lease y Circuit Breaker.
- Consulta de estado, listado, detalle y atención idempotente.
- Health, readiness, métricas Prometheus, Swagger/OpenAPI y cierre ordenado.

La validación con Node `24.22.1` pasa: `npm ci`, lint, formato, OpenAPI, 154 pruebas unitarias/API/E2E, 7 pruebas de integración Kafka, 10 de integración Firestore y smoke test de `/health` y `/api-docs`. La conexión real con Firestore también fue validada: `/ready` responde `READY` y una escritura/lectura/borrado temporal funcionó. Kafka local con Docker fue validado: topics creados, consumidor conectado, cinco handlers procesando eventos, duplicado idempotente y DLQ para sobre y datos inválidos. El flujo completo `evento Kafka -> Firestore -> scheduler -> correo console` quedó validado con dos notificaciones en estado `SENT`; un duplicado posterior no reenvió correos. La cobertura reportada corresponde al núcleo (`domain` y `application`), no a adaptadores, composición ni `main`.

El detalle de lo pendiente está en [`pendientes-fase-d.md`](./pendientes-fase-d.md). Los cambios específicos de la integración local con Kafka están en [`cambios-integracion-kafka-local.md`](./cambios-integracion-kafka-local.md).

## 2. Decisiones y restricciones vigentes

| Tema                | Decisión                                                                                |
| ------------------- | --------------------------------------------------------------------------------------- |
| Runtime             | Node.js `>=24.22.1`, CommonJS, sin transpilación.                                       |
| Framework HTTP      | Express 5.                                                                              |
| Persistencia        | Firestore con colecciones `alerts`, `notifications` y `processed_events`.               |
| Mensajería          | KafkaJS, `autoCommit=false`, commit manual y DLQ `fleetops.dlq.notification`.           |
| Correo              | `console` por defecto; `resend` solo si se configura `EMAIL_PROVIDER=resend`.           |
| Arquitectura        | Hexagonal: dominio y aplicación sin dependencias de Express, Firestore, Kafka o Resend. |
| Integración externa | Sin llamadas HTTP entre microservicios y sin publicación de eventos propios.            |
| Rutas               | REST en español bajo `/api/v1/notificaciones`.                                          |
| Fechas de respuesta | ISO 8601 con offset fijo de Bogotá `-05:00`.                                            |
| Seguridad de datos  | Correos enmascarados en respuestas y logs; no se almacenan secretos.                    |
| Despliegue          | Fuera de alcance de esta fase: sin Docker, Compose, Kubernetes ni CD.                   |

Estados y enums usados de forma definitiva:

- Severidad: `INFORMATIONAL`, `WARNING`, `CRITICAL`.
- Despacho: `PENDING_DISPATCH`, `SENT`, `FAILED`.
- Atención: `PENDING`, `ATTENDED`.
- Origen: `EVENT`, `MANUAL`.

## 3. Qué se implementó

### 3.1 Dominio

Archivos principales:

- `notification-service/src/domain/entities/alert.js`
- `notification-service/src/domain/entities/notification.js`
- `notification-service/src/domain/enums.js`
- `notification-service/src/domain/errors.js`
- `notification-service/src/domain/policies/attention.policy.js`
- `notification-service/src/domain/policies/dispatch.policy.js`
- `notification-service/src/domain/value-objects/recipient-email.js`

Funcionalidad:

- Entidades `Alert` y `Notification` con validación de campos, fechas y enums.
- Transiciones de despacho `PENDING_DISPATCH -> SENT | FAILED`.
- Transición de atención `PENDING -> ATTENDED` e idempotencia.
- Política de reintentos: 4 intentos totales, esperas de 30 s, 120 s y 600 s.
- Errores de dominio con códigos HTTP asociados.
- Normalización y validación de correo de empleado.

### 3.2 Aplicación

Handlers de eventos principales:

- `IncidenteReportadoEvent`: 1 alerta y 2 notificaciones.
- `AsignacionInterrumpidaEvent`: 1 alerta y 1 notificación; severidad `INFORMATIONAL` si `AUTOMATICA_EXITOSA`, en otro caso `WARNING`.
- `DocumentoProximoAVencerEvent`: 1 alerta y 1 notificación; acepta `dias_restantes` 30, 15 o 5.
- `DocumentoVencidoEvent`: 1 alerta y 1 notificación.
- `MantenimientoPreventivoRequeridoEvent`: 1 alerta y 2 notificaciones.

Eventos con contrato pendiente registrados explícitamente:

- `IncidenteLeveRegistradoEvent`
- `IncidenteGraveReportadoEvent`
- `AsignacionCreadaEvent`
- `AsignacionModificadaEvent`
- `ConsumoAnomaloDetectadoEvent`

Estos eventos se reconocen, pero no crean alertas, notificaciones ni documentos. Se registran y se ignoran de forma explícita; no se inventaron campos faltantes.

Casos de uso implementados:

- `ProcessDomainEvent`: deduplicación por `evento_id`, creación transaccional de alerta, notificaciones y `processed_events`.
- `CreateManualNotification`: creación manual de alerta y notificación; rechaza `EMPLOYEE` porque el POST no recibe correo.
- `DispatchPendingNotifications`: reserva con lease, envío, reintentos y Circuit Breaker.
- `GetNotificationStatus`: conteos agregados y alertas críticas pendientes.
- `ListNotifications`: filtros, paginación desde `page=0` y resumen por severidad/despacho.
- `GetNotification`: detalle con correo enmascarado.
- `MarkAlertAttended`: atención de la alerta y todas sus notificaciones en una transacción.

Plantillas de correo:

- `incident-report`
- `assignment-interrupted`
- `document-expiring`
- `document-expired`
- `maintenance-required`
- `manual-notification`

Todas generan texto plano UTF-8, sin HTML ni adjuntos.

### 3.3 Adaptadores de entrada

HTTP:

- `POST /api/v1/notificaciones`
- `GET /api/v1/notificaciones/estado`
- `GET /api/v1/notificaciones`
- `GET /api/v1/notificaciones/{id}`
- `PUT /api/v1/notificaciones/{id}/atender`
- `GET /health`
- `GET /ready`
- `GET /metrics`
- `GET /api-docs` con Swagger UI si `ENABLE_SWAGGER=true`

Características:

- Validación con Zod y errores en español.
- Cuerpo JSON limitado a 100 kB.
- `helmet` habilitado.
- Correlation ID entrante o generado; se devuelve en `x-correlation-id`.
- `pino-http` para logs estructurados.
- Manejo uniforme de errores `400`, `404`, `500` y `503`.
- `Location` en la creación manual.
- Paginación `page` desde 0 y `size` de 1 a 100.
- Filtros por rol, tipo, severidad, despacho, atención, referencia y rango de fechas.

Kafka:

- Parseo y validación del sobre: `evento_id`, `tipo_evento`, `fecha_evento`, `origen` y `datos`.
- `evento_id` debe ser UUID.
- Consumidor con commit manual.
- Reintentos transitorios con esperas de 2 s, 10 s y 30 s.
- `heartbeat()` durante las esperas.
- DLQ para sobre inválido, datos inválidos, error permanente o reintentos agotados.
- Solo se confirma el offset después del procesamiento o de publicar la DLQ.
- Si la DLQ falla, no se confirma el offset.

Scheduler:

- Ejecuta el despacho cada `DISPATCH_INTERVAL_MS` (10 s por defecto).
- Evita solapamiento de ejecuciones.
- Respeta el cierre ordenado.

### 3.4 Adaptadores de salida

Firestore:

- Cliente Firebase Admin con soporte de emulador y credenciales externas.
- Unit of Work transaccional.
- Repositorios de alertas, notificaciones y eventos procesados.
- Mappers entre entidades y documentos.
- Índices compuestos declarados en `firestore.indexes.json`.
- Fallback de listado de hasta 10.000 documentos cuando Firestore no puede resolver una combinación de filtros.
- Uso de `processed_events` para idempotencia de eventos.

Correo:

- `console-email-sender`: no envía correo real y enmascara destinatario.
- `resend-email-sender`: usa Resend e `idempotencyKey = notification_id`.
- `resilient-email-sender.decorator`: timeout, Circuit Breaker y clasificación de fallos transitorios/permanentes.
- Directorio de destinatarios por variable de entorno; `EMPLOYEE` usa el correo del evento.

Kafka:

- Cliente KafkaJS con SSL/SASL opcionales.
- Publicador de DLQ con motivo, error seguro, topic, partición, offset y mensaje original.

### 3.5 Configuración, composición y operación

- `src/config/env.schema.js`: validación completa de variables con Zod.
- `src/config/env.js`: carga de `.env` con `dotenv`.
- `src/config/composition-root.js`: composición explícita de dependencias.
- `src/config/shutdown.js`: cierre ordenado de HTTP, scheduler, Kafka y Firestore con timeout.
- `src/main.js`: arranque HTTP, Kafka opcional, señales `SIGTERM`/`SIGINT` y manejo de errores de arranque.
- `src/observability/logger.js`: Pino con correlación y redacción de datos sensibles.
- `src/observability/metrics.js`: métricas Prometheus.
- `src/observability/readiness.js`: chequeo con timeout; `503` solo si Firestore está caído.
- `src/observability/request-context.js`: contexto de correlación por petición.

Comportamiento operativo:

- `/health` responde `200` si el proceso está vivo.
- `/ready` responde `503` solo cuando Firestore falla; broker caído no invalida readiness por decisión de diseño.
- El scheduler arranca con el proceso y comienza a buscar pendientes de inmediato.
- El servicio puede operar con Kafka deshabilitado (`KAFKA_ENABLED=false`).
- El cierre intenta cerrar todos los recursos aunque uno falle.

### 3.6 Contrato y documentación

- `notification-service/openapi/notification-service.yaml`: OpenAPI 3.0.3.
- `notification-service/scripts/validate-openapi.js`: validación con Swagger Parser.
- `notification-service/README.md`: requisitos, configuración, endpoints, flujo y comandos.
- `notification-service/firebase.json`: configuración del emulador Firestore.
- `notification-service/firestore.indexes.json`: índices compuestos.
- `notification-service/.env.example`: variables de entorno sin secretos.

### 3.7 Pruebas y CI

Suites existentes:

- 12 suites unitarias.
- 1 suite de API con Supertest.
- 1 suite E2E por casos de uso.
- 1 suite de integración Kafka.
- 2 suites de integración Firestore: repositorios y flujo manual HTTP/scheduler.
- Helpers con repositorios y Unit of Work en memoria.

Cobertura funcional de pruebas:

- Entidades, enums, errores, políticas y value objects.
- Handlers principales y registro de eventos.
- Casos de uso y plantillas.
- Validación de entorno.
- Despacho, reintentos, Circuit Breaker simulado y scheduler.
- Readiness, cierre ordenado, señales y ciclo de vida del contenedor.
- API HTTP, validación, errores, máscaras y endpoints operativos.
- Flujo E2E de creación, consulta, despacho y atención.
- Flujo manual HTTP contra Firestore real, reinicio sin reenvío y fallo de correo aislado.

CI:

- `.github/workflows/ci.yml` ejecuta `npm ci`, lint, formato, validación OpenAPI, pruebas con cobertura y publica el artefacto de cobertura.
- No publica imágenes ni despliega.
- No ejecuta SonarCloud.

## 4. Verificación ejecutada

| Comando                                 | Resultado                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run lint`                          | Pasa sin errores.                                                                          |
| `npm run format:check`                  | Todos los archivos cumplen Prettier.                                                       |
| `npm run openapi:validate`              | `OpenAPI válido: openapi/notification-service.yaml`.                                       |
| `npm ci` con Node `24.22.1`             | 596 paquetes instalados sin errores.                                                       |
| `npm ls --all`                          | Código 0, sin extraneous, invalid ni missing; solo opcionales de plataforma.               |
| `npm run test:coverage -- --runInBand`  | 17 suites, 154 pruebas, todas pasan.                                                       |
| `npm run test:integration`              | 1 suite, 7 pruebas Kafka contra broker local, todas pasan.                                 |
| `npm run test:integration:firestore`    | 2 suites, 10 pruebas Firestore contra proyecto real, todas pasan.                          |
| `npm run test:integration:all`          | Kafka y Firestore en secuencia, 14 pruebas de integración verdes.                          |
| Cobertura del núcleo                    | 99.48 % statements, 92.56 % branches, 98.86 % functions, 99.47 % lines.                    |
| Smoke `createContainer` + `GET /health` | `200 {"status":"UP"}`.                                                                     |
| Smoke `GET /api-docs/`                  | `200` con Swagger UI.                                                                      |
| Smoke `src/main.js` + `GET /health`     | `200 {"status":"UP"}`.                                                                     |
| `src/main.js` + Firestore real          | `/ready` responde `200 READY` con `database.status = "UP"`.                                |
| Escritura/lectura/borrado en Firestore  | Documento temporal `_connection_test` creado, leído y eliminado.                           |
| Índices compuestos de Firestore         | 8/8 en `READY`; consultas de listado y conteo sin `FAILED_PRECONDITION`.                   |
| Kafka local + `GET /ready`              | `200 READY` con `broker.status = "UP"`.                                                    |
| Consumidor Kafka                        | Topics creados; eventos de incidente, asignación, documento y mantenimiento procesados.    |
| Evento duplicado                        | Resultado `duplicate`; no se crearon alertas ni notificaciones nuevas.                     |
| DLQ                                     | Sobre inválido y datos inválidos publicados con `INVALID_ENVELOPE` e `INVALID_EVENT_DATA`. |
| Scheduler + Firestore                   | `claimed=2, sent=2`; notificaciones en `SENT` con `sent_at` y `provider_message_id`.       |
| Flujo E2E Kafka                         | Evento procesado, scheduler envió dos correos `console` y el duplicado no reenvió nada.    |

La cobertura se calcula solo sobre `src/domain/**` y `src/application/**`. Los adaptadores, la composición, `main.js` y el cierre ordenado no están incluidos en el porcentaje.

## 5. Correcciones relevantes durante la implementación

- Se fijó `INFORMATIONAL` como severidad correcta; no se usa `INFO`.
- Se fijó `PENDING_DISPATCH` como estado inicial de despacho.
- La paginación comienza en `page=0`.
- El resumen usa `by_severity` y `by_dispatch_status`.
- `AsignacionInterrumpidaEvent` genera 1 alerta y 1 notificación, no dos notificaciones.
- Se corrigió el orden de lectura/escritura en la transacción de atención: todas las lecturas de Firestore ocurren antes de la primera escritura.
- Se alinearon rutas con el blueprint: `src/config/composition-root.js`, `src/config/shutdown.js`, senders y directorio de destinatarios.
- Se eliminó `additionalProperties: false` del request manual de OpenAPI para que el contrato coincida con el comportamiento real de ignorar campos desconocidos.
- Se permitió `next_attempt_at = null` en notificaciones `SENT`/`FAILED`; antes, leerlas desde Firestore fallaba con `Fecha inválida para next_attempt_at`.
- Los fallos intermitentes de la suite Firestore se atribuyeron al servicio local en ejecución: su scheduler reclamaba y marcaba `SENT` las notificaciones pendientes de la prueba. Las suites ahora se ejecutan con el servicio detenido y en secuencia.
- Se añadió la suite de flujo manual con Firestore real, HTTP, scheduler y correo simulado: POST manual, `PUT /atender` sobre varias notificaciones, reinicio sin reenvío y fallo de correo aislado.

## 6. Limitaciones y riesgos actuales

1. Firestore tiene 7/7 pruebas de repositorios y 3/3 del flujo manual; Kafka tiene 7/7. Las suites de Firestore corren contra el proyecto real y limpian sus datos; la de Kafka requiere el broker local. Ambas exigen detener el servicio local y ejecutarse en secuencia. Resend está validado con servidor HTTP controlado; falta el envío real con credenciales.
2. La transacción de atención quedó validada contra Firestore real, incluida la idempotencia y la atención de todas las notificaciones. No se detectó lectura después de escritura.
3. Los 8 índices compuestos de `firestore.indexes.json` están creados y en `READY`: el de despacho y los 7 restantes. Las consultas de listado por cada filtro y el conteo de alertas críticas pendientes se ejecutaron sin `FAILED_PRECONDITION`. La cuenta de servicio sigue sin permiso para crearlos por script (`403`), pero ya no es necesario porque se crearon manualmente desde la consola.
4. Los contratos exactos de varios eventos siguen pendientes; los handlers usan solo campos confirmados.
5. Node local es `26.12.1` y satisface `engines >=24.22.1`; CI fija `24.22.1`. No se reproduce `EBADENGINE`.
6. `npm ci` y `npm ls --all` se verificaron sin extraneous ni dependencias inválidas; solo quedan dependencias opcionales de plataforma no instaladas.
7. El repositorio git está inicializado en `notification-service/` con el commit base `fcda7d0`; no hay remoto ni PR.
8. Sonar está configurado en `sonar-project.properties`, pero no se ejecutó por falta de token/organización.
9. `main.js`, `composition-root.js`, `shutdown.js` y readiness ya tienen pruebas unitarias de ciclo de vida; el smoke con señales reales del sistema operativo sigue pendiente en Linux/CI. Kafka y los repositorios Firestore tienen suites de integración.
10. No hay autenticación ni RBAC locales; se delegan al API Gateway.
11. No hay dashboards, alertas operativas ni tracing; solo logs y métricas expuestas.
12. No hay pruebas de carga, seguridad de dependencias ni análisis de vulnerabilidades en CI.

## 7. Archivos de referencia

- Requisitos y alcance: `PROMPT_MAESTRO_ARQUETIPO_FLEETOPS_NOTIFICACIONES_G04.md`
- Análisis previo: `docs/entrega-1-analisis.md`
- Blueprint aprobado: `docs/entrega-2-blueprint.md`
- Estado actual: este documento
- Pendientes y backlog: `docs/pendientes-fase-d.md`
- Cambios de integración Kafka local: `docs/cambios-integracion-kafka-local.md`
- Servicio: `notification-service/`
- Contrato HTTP: `notification-service/openapi/notification-service.yaml`
