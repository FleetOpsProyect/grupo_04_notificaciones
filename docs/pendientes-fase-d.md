# Pendientes del arquetipo de Notificaciones (Fase D)

> **Documento histórico.** Los pendientes vigentes están en
> [`changelog-arquetipo-sqs-sns.md`](./changelog-arquetipo-sqs-sns.md), sección 7.  
> Este documento conserva el cierre de la Fase D original (Kafka, contratos en español).

## Resumen vigente de pendientes (2026-10-29)

1. Habilitar TTL de Firestore sobre `processed_events.expires_at` (30 días).
4. Fase 11: eliminar Kafka (`kafkajs`, adaptadores, `KAFKA_*`, `BROKER_TYPE`, scripts y suite).
5. CI/CD: job de integración con LocalStack, Quality Gate de Sonar y despliegue a EC2.
6. Confirmar con DevOps topics de Mantenimiento/Combustible y el nombre `fleetops_assigment_events`.

**Fecha de corte:** 2026-10-25  
**Documento de estado:** [`estado-implementacion-fase-d.md`](./estado-implementacion-fase-d.md)  
**Cambios de integración Kafka local:** [`cambios-integracion-kafka-local.md`](./cambios-integracion-kafka-local.md)  
**Objetivo:** dejar explícito qué falta para considerar el arquetipo listo para integración real, aceptación y una fase posterior de despliegue.

## 1. Prioridades

| Prioridad                   | Significado                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `P0`                        | Bloquea la validación real del servicio o la aceptación de la Fase D.                 |
| `P1`                        | Necesario para completar calidad, contratos y operación; puede hacerse después de P0. |
| `P2`                        | Endurecimiento, rendimiento y mejoras no bloqueantes.                                 |
| `Futuro / fuera de alcance` | No corresponde a esta fase; se documenta para evitar olvidos.                         |

## 2. Bloqueadores principales

1. Firestore tiene 7/7 pruebas de repositorios y 3/3 del flujo manual; Kafka tiene 7/7. El cierre por señales y los escenarios de readiness quedaron cubiertos en P0-07 con pruebas unitarias de ciclo de vida.
2. Resend se validó con un servidor HTTP controlado; falta el smoke real cuando existan credenciales y dominio verificado.
3. Los contratos exactos de varios eventos siguen pendientes de otros equipos.

## 3. Pendientes P0

### P0-01. Alinear y verificar el runtime

**Estado:** cerrado el 2026-10-25. Se mantiene Node `24.22.1` en `engines`, CI y `.nvmrc`; la versión existe en nodejs.org y está disponible para `actions/setup-node`. El entorno local quedó en Node `26.12.1`, que satisface `>=24.22.1`, sin `EBADENGINE`.

**Verificación:**

- `npm ci` ejecutado con Node `24.22.1`.
- Lint, formato y OpenAPI válidos.
- 154 pruebas unitarias/API/E2E, 7 de integración Kafka y 10 de Firestore.
- `npm ls --all` termina con código 0.

**Observación:** la suite Kafka puede fallar de forma transitoria en la primera creación de topics (`This server does not host this topic-partition`); un reintento con el broker estable pasó 7/7. No es un fallo de runtime ni de dependencias.

**Criterio de cierre:** cumplido con `npm ci`, lint, formato, OpenAPI y pruebas verdes en Node `24.22.1`, sin advertencias de engine.

### P0-02. Validar instalación limpia y árbol de dependencias

**Estado:** cerrado el 2026-10-25. El primer `npm ci` falló porque `package-lock.json` no estaba sincronizado: faltaban entradas de `@emnapi/core`/`@emnapi/runtime` y había una versión incompatible de `@emnapi/wasi-threads`. Se regeneró el lockfile con `npm install` bajo Node `24.22.1`.

**Verificación:**

- `npm ci` desde cero instala 596 paquetes sin errores.
- `npm ls --all` termina con código 0, sin dependencias `extraneous`, `invalid` ni `missing`.
- Solo quedan `UNMET OPTIONAL DEPENDENCY` de binarios específicos de plataforma, esperados por las dependencias opcionales.
- `package-lock.json` quedó actualizado y consistente con `package.json`.

**Criterio de cierre:** cumplido con instalación limpia, árbol sin extraneous y lockfile reproducible.

### P0-03. Pruebas de integración con Firestore

**Estado:** cerrado el 2026-10-25. La suite `test/integration/firestore.repositories.integration.test.js` pasa 7/7 contra el proyecto real `fleetops-notificaciones`. El comando `npm run test:integration:firestore` ejecuta además las 3 pruebas del flujo manual (P0-06), para 10/10 en total.

**Situación:** el proyecto real estaba vacío (solo índices) y Firestore creó las colecciones al primer documento de prueba. La suite usa IDs únicos, limpia alertas, notificaciones y eventos procesados después de cada prueba y verificó que no quedaran colecciones al finalizar.

**Cubierto:**

- Creación y lectura de alertas, notificaciones y eventos procesados, incluyendo fechas y valores nulos.
- Deduplicación por `evento_id` dentro de una transacción real.
- Rollback transaccional cuando falla una escritura.
- Atención de la alerta y todas sus notificaciones en una sola transacción, incluida la idempotencia.
- Reserva con lease, liberación, expiración, `markSent`, `markFailed` y `scheduleRetry`.
- Filtros, paginación, resumen, fallback sin índice compuesto y documentos inexistentes.
- Conteo de alertas críticas pendientes.

**Corrección derivada:** `Notification` ahora acepta `next_attempt_at = null` para estados finales (`SENT`/`FAILED`) y exige fecha solo en `PENDING_DISPATCH`. Antes, leer una notificación enviada o fallida desde Firestore fallaba con `Fecha inválida para next_attempt_at`.

**Condición de ejecución:** detener el servicio local (`npm run dev` o `npm start`) antes de correr la suite. Un scheduler activo comparte el proyecto real y puede reclamar y marcar `SENT` las notificaciones `PENDING_DISPATCH` de la prueba, lo que producía fallos intermitentes en filtros y conteos. Ejecutar Kafka y Firestore en secuencia (`npm run test:integration:all`), no en paralelo.

**Pendiente opcional:** mover la suite a Firestore Emulator para CI. La suite actual contra el proyecto real no se ejecuta en `npm test` ni en GitHub Actions.

**Criterio de cierre:** cumplido con suite verde, atención transaccional y evento duplicado validados.

### P0-04. Pruebas de integración con Kafka

**Estado:** cerrado el 2026-10-25. La suite `test/integration/kafka.consumer.integration.test.js` pasa 7/7 contra el broker local con `npm run test:integration`.

**Situación:** además del flujo principal y la DLQ, la suite cubre reintentos transitorios, agotamiento, sobre inválido, datos inválidos, evento ignorado, contrato pendiente, fallo al publicar en DLQ, reinicio con reprocesamiento y reinicio sin reprocesar offsets confirmados. El detalle está en [`cambios-integracion-kafka-local.md`](./cambios-integracion-kafka-local.md).

**Condición de ejecución:** detener el servicio local antes de la suite para evitar que su consumidor compita por el mismo grupo y consuma eventos de prueba. Ejecutar las suites de integración en secuencia.

**Cubierto:**

- Commit manual explícito y reinicio del consumidor.
- Evento desconocido y contrato pendiente ignorados sin DLQ.
- Reintentos con backoff acelerado y `heartbeat`; los valores reales `2000,10000,30000` se verifican en `test/unit/config.test.js`.
- Fallo transitorio persistente y agotamiento de reintentos.
- Fallo al publicar en DLQ: no se confirma el offset y el evento se reprocesa al reiniciar.
- Suite reproducible contra el broker local.

**Pendiente fuera de esta suite:** el cierre por `SIGTERM`/`SIGINT` se cubre en P0-07 con pruebas unitarias; el smoke con señales reales del sistema operativo queda pendiente en Linux/CI. La suite usa backoff de 20 ms para no esperar 42 s; los tiempos reales de producción se validan por configuración, no por espera real.

**Criterio de cierre:** cumplido con suite verde y evidencia de offsets confirmados y mensajes en DLQ.

### P0-05. Validar el adaptador de correo

**Estado:** cerrado el 2026-10-25 con proveedor simulado mediante servidor HTTP local. No se hizo un envío real porque no hay credenciales ni dominio verificado en Resend; ese smoke queda como verificación opcional.

**Situación:** `console` funciona; `resend` y el Circuit Breaker se validaron con el SDK real apuntando a un servidor HTTP controlado y con dobles del proveedor.

**Cubierto:**

- `test/unit/email.resend.test.js`: `POST /emails`, autenticación, `Idempotency-Key = notification_id`, cuerpo del mensaje, `provider_message_id`, 429/5xx transitorios, 4xx permanentes, respuesta sin ID, error de red y enmascaramiento de correos en el mensaje de error.
- `test/unit/email.resilience.test.js`: apertura, `half-open`, cierre, timeout, errores permanentes que no abren el breaker, liberación de reserva con `PENDING_DISPATCH` y logs sin correo completo ni cuerpo.
- `test/unit/kafka.dead-letter.test.js`: el payload de DLQ conserva el evento original, no agrega contenido de la notificación y enmascara correos en el error.
- `test/unit/shared.test.js`: `maskEmailsInText` y `safeErrorFields` enmascaran correos en mensajes arbitrarios.

**Corrección derivada:** `errorThresholdPercentage` estaba en `100` y Opossum usa una comparación estricta (`errorRate > threshold`), por lo que el Circuit Breaker nunca abría. Se ajustó a `99`. También se enmascaran correos en los errores de Resend y en `safeErrorFields` antes de enviarlos a logs o DLQ.

**Criterio de cierre:** cumplido con proveedor simulado y pruebas verdes; el envío real con Resend queda como smoke opcional cuando existan credenciales.

### P0-06. Flujo E2E con dependencias reales

**Estado:** cerrado el 2026-10-25. La suite `test/integration/manual-flow.integration.test.js` pasa 3/3 contra Firestore real con `npm run test:integration:firestore`; el comando ejecuta 10/10 pruebas de integración Firestore.

**Situación:** se ejecutó `evento Kafka -> Firestore -> scheduler -> correo console` en una validación previa. Ahora se añadió el flujo manual completo con HTTP, Firestore real, scheduler real y un proveedor de correo simulado inyectado en el contenedor.

**Cubierto:**

- `POST /api/v1/notificaciones` manual, persistencia de alerta y notificación, y despacho por el scheduler hasta `SENT` con `provider_message_id` y `sent_at`.
- `PUT /api/v1/notificaciones/{id}/atender` actualiza la alerta y todas sus notificaciones, incluida una segunda notificación creada para la misma alerta.
- Reinicio del contenedor: una notificación `SENT` no se vuelve a reclamar ni se reenvía.
- Fallo permanente de correo para una notificación del lote: queda `FAILED` y la otra se envía, sin bloquear el resto.

**Criterio de cierre:** cumplido con Firestore real, HTTP real, scheduler real y proveedor de correo simulado.

### P0-07. Verificar arranque, readiness y cierre ordenado

**Estado:** cerrado el 2026-10-25 con pruebas unitarias de ciclo de vida. El smoke con señales reales del sistema operativo queda como verificación manual en Linux/CI; Windows no entrega `SIGTERM`/`SIGINT` de forma fiable a un proceso hijo.

**Situación:** se validó `src/main.js` con Firestore real y Kafka local: `/health` y `/ready` responden `200`, con `database.status = "UP"` y `broker.status = "UP"`. Ahora se cubren también los escenarios de fallo, el arranque con Kafka deshabilitado y el cierre ordenado.

**Cubierto:**

- `test/unit/readiness.test.js`: Firestore arriba/abajo, broker arriba/abajo/deshabilitado, broker caído sin bloquear readiness y timeout de chequeos.
- `test/unit/container-lifecycle.test.js`: arranque con Kafka deshabilitado, `/ready` `503` con Firestore caído, `/ready` `200` con broker `DISABLED`, cierre de Firestore y arranque/cierre idempotentes.
- `test/unit/main.test.js`: `SIGTERM` y `SIGINT`, cierre único, salida `0` en cierre correcto, salida `1` ante fallo de arranque o de cierre y cierre disparado por error del servidor HTTP.
- `test/unit/shutdown.test.js`: cierre de HTTP real, cierre parcial cuando una dependencia falla, tolerancia a `ERR_SERVER_NOT_RUNNING` y salida forzada por timeout.
- `test/unit/scheduler.test.js`: ciclos sin solapamiento y `stop()` que espera la ejecución en curso.

**Corrección derivada:** `container.stop()` ahora memoriza su promesa para que llamadas repetidas o concurrentes no cierren dos veces Firestore ni los clientes de Kafka.

**Pendiente manual:** ejecutar el binario con señales reales en Linux/CI y verificar que no queden sockets ni intervalos abiertos. La lógica de cierre ya está cubierta por pruebas.

**Criterio de cierre:** cumplido con pruebas de ciclo de vida verdes, salida `0` en cierre correcto y salida `1` ante fallo real.

### P0-08. Desplegar y validar índices de Firestore

**Estado:** completado para los 8 índices del contrato (2026-10-24).

**Situación:** los 8 índices compuestos de `firestore.indexes.json` están creados y en `READY`. Se verificó la definición exacta contra Firestore Admin API y se ejecutaron las consultas de listado por `recipient_role`, `type`, `severity`, `dispatch_status`, `attention_status`, `reference_id`, además del conteo de alertas críticas pendientes, sin `FAILED_PRECONDITION`.

**Observación:** el script `npm run firestore:indexes` sigue recibiendo `403 PERMISSION_DENIED` porque la cuenta de servicio no tiene `datastore.indexes.create`; los índices se crearon manualmente desde la consola. Las combinaciones de varios filtros pueden requerir índices adicionales y, si falta uno, el código usa el fallback de hasta 10.000 documentos.

**Criterio de cierre:** cumplido para los índices definidos en el contrato; el fallback sigue disponible como contingencia.

## 4. Pendientes P1

### P1-01. Cerrar contratos externos de eventos

Contratos parciales:

| Evento                                  | Confirmado               | Pendiente                                      |
| --------------------------------------- | ------------------------ | ---------------------------------------------- |
| `IncidenteReportadoEvent`               | Ejemplo base del DAS     | Cuerpo exacto y textos definitivos.            |
| `AsignacionInterrumpidaEvent`           | `empleado_email`         | Nombre exacto del campo de resultado y cuerpo. |
| `DocumentoProximoAVencerEvent`          | `dias_restantes` 30/15/5 | IDs y nombres exactos de entidad/documento.    |
| `DocumentoVencidoEvent`                 | Evento de vencimiento    | IDs y nombres exactos.                         |
| `MantenimientoPreventivoRequeridoEvent` | Kilómetros               | IDs y nombres exactos.                         |

Contratos no formalizados:

- `IncidenteLeveRegistradoEvent`
- `IncidenteGraveReportadoEvent`
- `AsignacionCreadaEvent`
- `AsignacionModificadaEvent`
- `ConsumoAnomaloDetectadoEvent`

**Falta:**

- Obtener los contratos definitivos de los equipos productores.
- No inventar campos ni significados.
- Actualizar handlers, plantillas, pruebas y OpenAPI si aplica.
- Convertir los eventos pendientes en handlers reales solo cuando exista contrato.
- Definir versión de evento y política de compatibilidad.

**Criterio de cierre:** contratos versionados y pruebas de contrato para los diez tipos de evento.

### P1-02. Añadir fixtures y pruebas de contrato

**Falta:**

- Crear `test/fixtures/events/` con sobres válidos e inválidos.
- Crear fixtures de notificaciones y respuestas API.
- Probar cada handler con payload mínimo y con campos extra.
- Probar campos faltantes, enums inválidos y fechas inválidas.
- Probar que los eventos pendientes se ignoran sin persistencia.
- Probar que un evento desconocido se ignora sin DLQ.

**Criterio de cierre:** fixtures versionados y pruebas de contrato ejecutables en CI.

### P1-03. Ampliar cobertura a adaptadores y composición

**Situación:** la cobertura actual solo mide `src/domain/**` y `src/application/**`.

**Falta:**

- Definir si la cobertura debe incluir adaptadores, configuración, composición y `main`.
- Añadir pruebas para `env.js`, `composition-root.js`, `shutdown.js` y `main.js`.
- Ampliar la cobertura de adaptadores y composición (Firestore, Kafka, Resend, scheduler y readiness).
- Ajustar `collectCoverageFrom` y umbrales de forma realista.
- Publicar cobertura por capas y no solo un porcentaje global.

**Criterio de cierre:** cobertura representativa del código ejecutable y umbral acordado, sin ocultar adaptadores.

### P1-04. Pruebas dedicadas de health, readiness y métricas

**Falta:**

- Separar `health.api.test.js`, `metrics.api.test.js` y readiness.
- Probar `/ready` con Firestore arriba/abajo y broker arriba/abajo.
- Probar timeout de readiness.
- Probar formato y contenido de métricas.
- Probar que `/metrics` no filtra datos sensibles.
- Probar Swagger habilitado y deshabilitado.

**Criterio de cierre:** endpoints operativos cubiertos de forma dedicada.

### P1-05. Operación de DLQ

**Falta:**

- Definir esquema estable del mensaje de DLQ.
- Añadir procedimiento de inspección y replay.
- Definir si el replay es manual o automatizado.
- Añadir métrica y alerta por mensajes en DLQ.
- Probar replay sin duplicar efectos.
- Documentar retención y limpieza.

**Criterio de cierre:** runbook de DLQ y al menos un replay controlado en integración.

### P1-06. Observabilidad operativa

**Falta:**

- Dashboards para volumen, errores, latencia, reintentos y DLQ.
- Alertas para Circuit Breaker abierto, readiness caído y DLQ creciente.
- Trazas o propagación de correlación más allá de logs.
- Definir SLO/SLI.
- Revisar cardinalidad de métricas.
- Documentar qué logs son seguros y cuáles no.

**Criterio de cierre:** métricas clave con alertas y procedimiento de diagnóstico.

### P1-07. Seguridad y dependencias

**Falta:**

- Ejecutar `npm audit` y definir política de vulnerabilidades.
- Añadir escaneo de dependencias en CI.
- Evaluar rate limiting o límites de petición.
- Revisar CORS y exposición de Swagger en producción.
- Documentar límites de autenticación/RBAC delegados al API Gateway.
- Revisar que no se registran correos completos ni secretos.
- Añadir pruebas de payload excesivo y JSON malformado.

**Criterio de cierre:** revisión de seguridad documentada y CI sin vulnerabilidades críticas conocidas.

### P1-08. Rendimiento y capacidad

**Falta:**

- Medir despacho por lote y latencia de Firestore.
- Medir consultas de listado con y sin índice.
- Evaluar el fallback de 10.000 documentos.
- Probar concurrencia de scheduler y leases.
- Definir límites de batch, lease y timeout.
- Evaluar paginación por offset frente a cursor.
- Añadir prueba de carga básica.

**Criterio de cierre:** resultados de carga y configuración recomendada documentados.

### P1-09. Conformidad OpenAPI

**Falta:**

- Probar respuestas reales contra el contrato OpenAPI.
- Revisar ejemplos y esquemas de error.
- Verificar que todos los códigos documentados se producen.
- Revisar `Location`, `x-correlation-id` y máscaras.
- Decidir si el 404 de ruta desconocida usa `NOT_FOUND` o un código documentado.
- Validar Swagger en CI con el documento final.

**Criterio de cierre:** pruebas de conformidad o revisión formal del contrato.

### P1-10. Idempotencia del POST manual

**Situación:** los eventos se deduplican por `evento_id`, pero el POST manual no tiene clave de idempotencia.

**Falta:**

- Confirmar si el requisito exige idempotencia para creación manual.
- Si aplica, definir header o campo de idempotencia.
- Persistir la clave y devolver la misma respuesta ante reintentos.
- Añadir pruebas de reintento.

**Criterio de cierre:** requisito decidido y, si aplica, implementado con pruebas.

### P1-11. Base versionada y control de cambios

**Situación:** el directorio no es un repositorio git.

**Falta:**

- Inicializar repositorio o integrarlo en el repositorio institucional.
- Definir ramas y política de commits.
- Añadir `.gitignore` verificado.
- Revisar que no se versionan `.env`, credenciales, `coverage` ni `node_modules`.
- Configurar protección de rama y revisión.
- Crear un commit base reproducible.

**Criterio de cierre:** repositorio versionado con primer commit y CI asociado.

### P1-12. SonarQube/SonarCloud

**Situación:** existe `sonar-project.properties`, pero no se ejecutó el análisis.

**Falta:**

- Definir organización, proyecto y token.
- Configurar el escaneo en CI o en un job separado.
- Publicar `coverage/lcov.info`.
- Revisar quality gate, duplicación, code smells y vulnerabilidades.
- Documentar exclusiones de cobertura de forma justificada.

**Criterio de cierre:** análisis ejecutado y quality gate revisado.

### P1-13. Actualizar documentación tras integración

**Falta:**

- Actualizar estado de pruebas y cobertura con resultados reales.
- Documentar contratos definitivos.
- Documentar índices desplegados.
- Documentar variables y secretos por entorno.
- Añadir runbooks de arranque, DLQ, incidentes y rollback lógico.
- Registrar decisiones y desviaciones finales.

**Criterio de cierre:** documentación coherente con el código y la infraestructura de integración.

## 5. Pendientes P2

- Añadir jitter a los reintentos de correo si se requiere evitar sincronización.
- Evaluar paginación por cursor para listados grandes.
- Añadir compresión HTTP o cacheo si el volumen lo justifica.
- Definir política de retención y borrado de notificaciones.
- Añadir trazabilidad distribuida completa.
- Añadir pruebas de contrato con consumidores externos.
- Añadir pruebas de caos para Firestore, Kafka y proveedor de correo.
- Documentar límites de escalado horizontal del scheduler y del consumidor.
- Añadir métricas de negocio por tipo/severidad y alertas de KPI.
- Revisar la estrategia de versionado de eventos y migraciones.
- Añadir scripts de desarrollo para emulador y datos de prueba.
- Revisar dependencias y fijar política de actualización.

## 6. Fuera de alcance de la Fase D

No forman parte de esta fase y no deben confundirse con defectos del arquetipo:

- Dockerfile, Docker Compose, Kubernetes, manifiestos, CD o publicación de imágenes.
- API Gateway, Cognito, autenticación y RBAC propios del servicio.
- Publicación de eventos de Notificaciones hacia otros microservicios.
- Llamadas HTTP a otros microservicios.
- Persistencia SQL, JPA, Flyway o PostgreSQL.
- Correos externos a contactos no confirmados.
- dashboards o alertas productivas gestionadas fuera del repositorio.
- Aprovisionamiento de Firestore, Kafka o Resend en la nube.

## 7. Matriz de pruebas pendientes

| Área            | Estado actual                     | Falta                                                  |
| --------------- | --------------------------------- | ------------------------------------------------------ |
| Dominio         | Unitarias                         | Nada bloqueante.                                       |
| Aplicación      | Unitarias/E2E en memoria          | Casos con contratos definitivos.                       |
| HTTP            | API con Supertest                 | Conformidad OpenAPI y carga.                           |
| Firestore       | Repositorios 7/7 + flujo manual 3/3 | Emulador para CI; nada bloqueante en local.          |
| Kafka           | Suite 7/7 contra broker local     | Nada bloqueante en local.                              |
| Resend          | Servidor HTTP controlado + dobles | Smoke real cuando existan credenciales y dominio.      |
| Scheduler       | Fallos y reinicio cubiertos       | Concurrencia y carga.                                  |
| Readiness       | Cubierto con pruebas unitarias    | Smoke con dependencias reales en CI.                   |
| Cierre ordenado | Cubierto con pruebas unitarias    | Smoke con señales reales en Linux/CI.                  |
| Seguridad       | Revisión básica                   | Auditoría de dependencias y pruebas de abuso.          |
| Rendimiento     | No ejecutado                      | Carga, latencia y capacidad.                           |
| Sonar           | No ejecutado                      | Análisis y quality gate.                               |
| CI              | Calidad básica                    | Integración, Sonar y escaneo de seguridad.             |

## 8. Criterios de aceptación para cerrar la fase

- [x] Runtime y `npm ci` reproducibles, sin extraneous.
- [x] Firestore con suite de integración verde (10/10: repositorios y flujo manual).
- [x] Kafka real o entorno de integración con suite verde (7/7).
- [x] Adaptador de correo validado con proveedor simulado; envío real con Resend pendiente de credenciales.
- [x] Flujo E2E con dependencias reales documentado.
- [x] Arranque, readiness y cierre ordenado verificados con pruebas unitarias.
- [x] Índices desplegados y consultas principales probadas.
- [ ] Contratos de eventos confirmados o explícitamente aplazados.
- [ ] Cobertura y Sonar revisados según el alcance acordado.
- [ ] Documentación y runbooks actualizados.
- [ ] Sin secretos, correos reales ni credenciales en el repositorio.

## 9. Orden recomendado

1. Alinear Node y validar instalación limpia.
2. Completado: suite de integración Firestore 10/10 contra el proyecto real (repositorios y flujo manual).
3. Probar las consultas de listado sin fallback y documentar combinaciones adicionales.
4. Completado: suite de integración Kafka 7/7 (reintentos, DLQ, fallo de DLQ y reinicio).
5. Validar correo y Circuit Breaker.
6. Completar contratos externos y fixtures.
7. Añadir pruebas de ciclo de vida, seguridad, carga y Sonar.
8. Versionar el repositorio y actualizar documentación final.

## 10. Comandos de referencia

Desde `notification-service/`:

```bash
npm ci
npm run lint
npm run format:check
npm run openapi:validate
npm test -- --runInBand
npm run test:integration
npm run test:integration:firestore
npm run test:coverage -- --runInBand
npm run kafka:setup
npm run kafka:publish -- incident
npm run firestore:event -- <evento_id>
npm run firestore:cleanup -- <evento_id>
```

`npm run test:integration:firestore` usa el proyecto real configurado en `.env` y limpia los datos de prueba. Para Firestore Emulator, usar Firebase CLI con `firebase.json` y el proyecto `demo-fleetops`. La integración Kafka local está disponible con Docker; `npm run test:integration` requiere el broker local levantado. El comando completo está en `README.md` y en [`cambios-integracion-kafka-local.md`](./cambios-integracion-kafka-local.md). Resend se valida con servidor HTTP controlado; el smoke real requiere credenciales y dominio verificado.

## 11. Reglas para no introducir regresiones

- No inventar campos de contratos pendientes.
- Mantener `AsignacionInterrumpidaEvent` con 1 alerta y 1 notificación.
- No cambiar `INFORMATIONAL` por `INFO`.
- No cambiar `PENDING_DISPATCH` por otro estado inicial.
- Mantener `page` iniciando en 0.
- Mantener `by_severity` y `by_dispatch_status` en los resúmenes.
- No registrar correos completos ni secretos.
- No publicar eventos propios ni llamar a otros servicios por HTTP.
- No añadir despliegue en esta fase.
- Toda lectura de Firestore dentro de una transacción debe ocurrir antes de la primera escritura.
