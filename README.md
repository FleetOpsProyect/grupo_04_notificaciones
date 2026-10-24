# FleetOps Notification Service

Arquetipo funcional del microservicio de Notificaciones de FleetOps (Grupo 04). Implementa el
núcleo de la Fase D sobre una arquitectura hexagonal: dominio y aplicación puros, adaptadores de
entrada/salida y composición explícita.

El alcance de esta fase **no incluye despliegue**. No hay Compose, manifiestos de Kubernetes ni
pipeline de CD. Docker se usa únicamente para levantar un broker Kafka local de desarrollo. El único
automatismo de integración es GitHub Actions para calidad.

## Requisitos

- Node.js `>=24.22.1`
- npm
- Firestore (emulador o proyecto administrado) para persistencia real
- Kafka opcional; si `KAFKA_ENABLED=false` el consumidor no arranca
- Docker solo si se usa Kafka local

## Configuración local

```bash
npm ci
cp .env.example .env
npm start
```

Por defecto el servicio usa `EMAIL_PROVIDER=console`, por lo que no envía correos reales. Para
Firestore local configure `FIRESTORE_EMULATOR_HOST` y `FIREBASE_PROJECT_ID`.

### Kafka local con Docker

```bash
docker run -d --name fleetops-kafka -p 9092:9092 \
  -e CLUSTER_ID=MkU3OEVBNTcwNTJENDM2Qk \
  -e KAFKA_NODE_ID=1 \
  -e KAFKA_PROCESS_ROLES=broker,controller \
  -e KAFKA_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093 \
  -e KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://localhost:9092 \
  -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER \
  -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT \
  -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093 \
  -e KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT \
  -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
  -e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 \
  -e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 \
  -e KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0 \
  -e KAFKA_NUM_PARTITIONS=1 \
  -e KAFKA_AUTO_CREATE_TOPICS_ENABLE=true \
  apache/kafka:3.9.0

npm run kafka:setup
```

Configure `KAFKA_ENABLED=true` y `KAFKA_BROKERS=127.0.0.1:9092` en `.env`. Para el primer arranque
en frío conviene `READINESS_TIMEOUT_MS=10000`.

Publicar eventos de prueba y verificar el resultado:

```bash
npm run kafka:publish -- incident
npm run kafka:publish -- invalid-envelope
npm run firestore:event -- <evento_id>
npm run firestore:cleanup -- <evento_id>
```

La creación de los índices de Firestore requiere permisos de `datastore.indexes.create`:

```bash
npm run firestore:indexes
```

Variables relevantes:

| Variable                          | Uso                                                  |
| --------------------------------- | ---------------------------------------------------- |
| `PORT`                            | Puerto HTTP, `3000` por defecto                      |
| `FIREBASE_PROJECT_ID`             | Proyecto Firestore                                   |
| `FIRESTORE_EMULATOR_HOST`         | Emulador local de Firestore                          |
| `KAFKA_ENABLED`                   | Habilita consumidor y DLQ                            |
| `KAFKA_BROKERS`, `KAFKA_GROUP_ID` | Conexión y grupo consumidor                          |
| `EMAIL_PROVIDER`                  | `console` o `resend`                                 |
| `RESEND_API_KEY`                  | Obligatoria con `EMAIL_PROVIDER=resend`              |
| `EMAIL_RETRY_DELAYS_MS`           | Backoff de correo, por defecto `30000,120000,600000` |
| `DISPATCH_INTERVAL_MS`            | Frecuencia del scheduler, `10000` por defecto        |
| `RECIPIENT_*`                     | Correos de destino por rol                           |

## Endpoints

| Método | Ruta                                 | Descripción                               |
| ------ | ------------------------------------ | ----------------------------------------- |
| `POST` | `/api/v1/notificaciones`             | Crea alerta y notificación manual         |
| `GET`  | `/api/v1/notificaciones/estado`      | Conteos agregados                         |
| `GET`  | `/api/v1/notificaciones`             | Listado con filtros, paginación y resumen |
| `GET`  | `/api/v1/notificaciones/:id`         | Detalle con correo enmascarado            |
| `PUT`  | `/api/v1/notificaciones/:id/atender` | Atención idempotente                      |
| `GET`  | `/health`                            | Liveness                                  |
| `GET`  | `/ready`                             | Readiness; `503` solo si Firestore falla  |
| `GET`  | `/metrics`                           | Métricas Prometheus                       |
| `GET`  | `/api-docs`                          | Swagger UI si `ENABLE_SWAGGER=true`       |

Contrato completo: `openapi/notification-service.yaml`.

## Flujo principal

1. Kafka entrega un sobre con `evento_id`, `tipo_evento`, `fecha_evento`, `origen` y `datos`.
2. El registry resuelve uno de los diez tipos de evento registrados.
3. `ProcessDomainEvent` valida el payload y, en una transacción, crea la alerta, sus notificaciones
   y `processed_events/{evento_id}`.
4. El scheduler toma notificaciones `PENDING_DISPATCH` vencidas, reserva con lease y envía correo.
5. Los fallos transitorios se reprograman; los permanentes o el agotamiento de intentos dejan
   `FAILED`. Un Circuit Breaker abierto libera la reserva y conserva `PENDING_DISPATCH`.
6. `PUT /atender` actualiza la alerta y todas sus notificaciones a `ATTENDED`.

## Comandos

```bash
npm test                  # unitarias, API y E2E con dobles en memoria
npm run test:coverage     # cobertura del núcleo
npm run lint              # ESLint
npm run format:check      # Prettier
npm run openapi:validate  # Swagger Parser
npm run kafka:setup       # Crea los topics configurados
npm run kafka:publish     # Publica un evento de prueba
npm run firestore:event   # Inspecciona un evento procesado
npm run firestore:cleanup # Elimina datos de un evento de prueba
npm run firestore:indexes # Despliega los índices compuestos
```

## Estructura

```text
src/
  domain/          entidades, enums, errores, políticas y value objects
  application/     handlers, plantillas, puertos y casos de uso
  adapters/in/     HTTP, Kafka y scheduler
  adapters/out/    Firestore, correo, directorio y DLQ
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
- El índice `dispatch_status + next_attempt_at` ya está creado y el flujo
  `Kafka -> Firestore -> scheduler -> correo console` funciona. Los otros seis índices de listado
  siguen pendientes; la cuenta de servicio actual no tiene permiso para crearlos.
- La autenticación/RBAC se delega al API Gateway; este servicio no valida JWT.
- Los contratos de varios eventos siguen pendientes. Los handlers toleran campos opcionales y los
  eventos sin contrato se ignoran explícitamente.
- La cobertura objetivo del núcleo está configurada en 90 % de líneas/funciones/statements y 85 %
  de ramas.
- CI ejecuta lint, formato, OpenAPI y pruebas con cobertura; no publica imágenes ni despliega.

## Documentación relacionada

- Estado de Fase D: `../docs/estado-implementacion-fase-d.md`
- Pendientes: `../docs/pendientes-fase-d.md`
- Cambios de integración Kafka local: `../docs/cambios-integracion-kafka-local.md`
