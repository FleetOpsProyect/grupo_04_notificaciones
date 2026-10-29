# FleetOps Notification Service

Arquetipo funcional del microservicio de Notificaciones de FleetOps (Grupo 04). Implementa el
núcleo de la Fase D sobre una arquitectura hexagonal: dominio y aplicación puros, adaptadores de
entrada/salida y composición explícita.

El alcance de esta fase **no incluye despliegue**. No hay manifiestos de Kubernetes ni pipeline de
CD. Docker se usa para levantar LocalStack (SQS/SNS) en desarrollo y pruebas de integración. El único
automatismo de integración es GitHub Actions para calidad.

## Requisitos

- Node.js `>=24.22.1`; CI y `.nvmrc` fijan `24.22.1`
- npm
- Firestore (emulador o proyecto administrado) para persistencia real
- Docker para LocalStack (SQS/SNS) en desarrollo y pruebas de integración

## Configuración local

```bash
npm ci
cp .env.example .env
npm start
```

Por defecto el servicio usa `EMAIL_PROVIDER=console`, por lo que no envía correos reales. Para
Firestore local configure `FIRESTORE_EMULATOR_HOST` y `FIREBASE_PROJECT_ID`.

### Correo con Resend

Para envío real configure `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` y `EMAIL_FROM`. El remitente debe
ser un correo plano, sin `Nombre <correo>`; además, el dominio debe estar verificado en Resend
(SPF/DKIM) o usar `onboarding@resend.dev` únicamente hacia el correo de la cuenta. La API key debe
tener permiso de envío. No incluya credenciales en el repositorio ni en los logs.

### Integración SQS/SNS con LocalStack

La suite de integración usa Amazon SQS FIFO y SNS en LocalStack.

```bash
docker compose -f docker-compose.localstack.yml up -d
npm run sqs:setup:localstack
npm run test:integration
```

`npm test` omite la suite de integración. Para ejecutarla se necesita LocalStack en `AWS_ENDPOINT_URL` (por defecto `http://127.0.0.1:4566`) y las variables `SQS_*` del `.env`.

Antes de ejecutar cualquier suite de integración, detenga el servicio local (`npm run dev` o `npm start`). El consumidor y el scheduler en ejecución comparten la misma cola y proyecto de Firestore, por lo que pueden consumir eventos de prueba o despachar notificaciones pendientes y volver las pruebas intermitentes.

Publicar eventos de prueba y verificar el resultado:

```bash
npm run sqs:publish -- incident
npm run sqs:publish -- minor-incident
npm run sqs:publish -- fuel
npm run sqs:publish -- invalid-envelope
npm run firestore:event -- <event_id>
npm run firestore:cleanup -- <event_id>
```

La suite de integración SQS crea colas temporales propias, valida procesamiento, DLQ por sobre inválido, DLQ por error permanente y el paso a DLQ tras 4 recepciones fallidas.

La creación de los índices de Firestore requiere permisos de `datastore.indexes.create`:

```bash
npm run firestore:indexes
```

La suite de integración de Firestore usa el proyecto real configurado en `.env`, crea documentos con IDs únicos y los elimina al finalizar. Incluye repositorios y el flujo manual HTTP/scheduler con correo simulado:

```bash
npm run test:integration:firestore
npm run test:integration:all   # SQS y Firestore en secuencia
```

Ejecute las suites en secuencia, no en paralelo. Si el servicio local sigue activo, su scheduler puede reclamar y marcar `SENT` las notificaciones `PENDING_DISPATCH` creadas por la prueba.

Variables relevantes:

| Variable                       | Uso                                                  |
| ------------------------------ | ---------------------------------------------------- |
| `PORT`                         | Puerto HTTP, `3000` por defecto                      |
| `FIREBASE_PROJECT_ID`          | Proyecto Firestore                                   |
| `FIRESTORE_EMULATOR_HOST`      | Emulador local de Firestore                          |
| `SQS_QUEUE_URL`, `SQS_DLQ_URL` | Colas FIFO del servicio                              |
| `SQS_MAX_RECEIVE_COUNT`        | Recepciones antes de DLQ, `4` por defecto            |
| `SNS_NOTIFICATION_TOPIC_ARN`   | Topic SNS propio para eventos `notification_*`       |
| `EMAIL_PROVIDER`               | `console` o `resend`                                 |
| `RESEND_API_KEY`               | Obligatoria con `EMAIL_PROVIDER=resend`              |
| `EMAIL_FROM`                   | Remitente verificado; correo plano, sin nombre       |
| `EMAIL_RETRY_DELAYS_MS`        | Backoff de correo, por defecto `30000,120000,600000` |
| `DISPATCH_INTERVAL_MS`         | Frecuencia del scheduler, `10000` por defecto        |
| `RECIPIENT_*`                  | Correos de destino por rol                           |

## Endpoints

| Método | Ruta                                 | Descripción                               |
| ------ | ------------------------------------ | ----------------------------------------- |
| `POST` | `/notifications`                     | Crea alerta y notificación manual         |
| `GET`  | `/notifications/status`              | Conteos agregados                         |
| `GET`  | `/notifications`                     | Listado con filtros, paginación y resumen |
| `GET`  | `/notifications/:id`                 | Detalle con correo enmascarado            |
| `PUT`  | `/notifications/:id/acknowledgement` | Reconocimiento idempotente                |
| `GET`  | `/health`                            | Liveness                                  |
| `GET`  | `/ready`                             | Readiness; `503` solo si Firestore falla  |
| `GET`  | `/metrics`                           | Métricas Prometheus                       |
| `GET`  | `/api-docs`                          | Swagger UI si `ENABLE_SWAGGER=true`       |

Contrato completo: `openapi/notification-service.yaml`.

## Flujo principal

1. SQS entrega un sobre con `event_id`, `event_type`, `version`, `occurred_at`, `source`,
   `correlation_id` y `data`.
2. El registry resuelve uno de los siete eventos con aviso (más el alias de combustible).
3. `ProcessDomainEvent` valida el sobre y, en una transacción, crea la alerta, sus notificaciones,
   `processed_events/{event_id}` y los `notification_created_event` en la outbox.
4. El scheduler toma notificaciones `PENDING` vencidas, reserva con lease y envía correo.
5. Los fallos transitorios se reprograman; los permanentes o el agotamiento de intentos dejan
   `FAILED`. Un Circuit Breaker abierto libera la reserva y conserva `PENDING_DISPATCH`.
6. `PUT /acknowledgement` actualiza la alerta y todas sus notificaciones a `ACKNOWLEDGED`.

## Comandos

```bash
npm test                  # unitarias, API y E2E con dobles en memoria
npm run test:integration  # integración SQS/SNS contra LocalStack
npm run test:integration:firestore # integración Firestore contra proyecto real
npm run test:integration:all # SQS y Firestore en secuencia
npm run test:coverage     # cobertura del núcleo
npm run lint              # ESLint
npm run format:check      # Prettier
npm run openapi:validate  # Swagger Parser
npm run sqs:setup:localstack # Crea colas FIFO y topic SNS en LocalStack
npm run sqs:publish          # Publica un evento de prueba
npm run firestore:event   # Inspecciona un evento procesado
npm run firestore:cleanup # Elimina datos de un evento de prueba
npm run firestore:indexes # Despliega los índices compuestos
```

## Estructura

```text
src/
  domain/          entidades, enums, errores, políticas y value objects
  application/     handlers, plantillas, puertos y casos de uso
  adapters/in/     HTTP, SQS y scheduler
  adapters/out/    Firestore, correo, directorio, SQS DLQ y SNS
  observability/   logs, métricas y readiness
  config/          entorno, composición y cierre ordenado
  main.js
openapi/
scripts/
test/
```

## Decisiones y límites conocidos

- CommonJS, Node.js y Jest; sin transpilación.
- Consultas de listado con filtros compuestos usan índices; si Firestore no puede resolver una
  combinación, se ejecuta un fallback acotado a 10.000 documentos.
- El índice `delivery_status + next_attempt_at` y el de outbox están creados y el flujo
  `SQS -> Firestore -> scheduler -> correo console -> outbox -> SNS` funciona. Los 9 índices
  compuestos están creados y en `READY`; la cuenta de servicio no tiene permiso para crearlos por script.
- La autenticación/RBAC se delega al API Gateway; este servicio no valida JWT.
- Los contratos de varios eventos siguen pendientes. Los handlers toleran campos opcionales y los
  eventos sin contrato se ignoran explícitamente.
- La cobertura objetivo del núcleo está configurada en 90 % de líneas/funciones/statements y 85 %
  de ramas.
- CI ejecuta lint, formato, OpenAPI y pruebas con cobertura; no levanta LocalStack ni Firestore ni publica imágenes.
- Las suites de integración se ejecutan localmente con `npm run test:integration`, `npm run test:integration:firestore` o ambas en secuencia con `npm run test:integration:all`.

## Documentación relacionada

- Changelog vigente: `docs/changelog-arquetipo-sqs-sns.md`
- Plan de migración: `docs/plan-cambio-kafka-a-sqs-sns.md`
- Estado histórico de Fase D: `docs/estado-implementacion-fase-d.md`
