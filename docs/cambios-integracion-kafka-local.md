# Cambios de integración con Kafka local

**Fecha:** 2026-10-25  
**Alcance:** `notification-service/` y documentación de Fase D  
**Objetivo:** dejar registrada la integración de Kafka local con Docker, la configuración usada, las herramientas añadidas, la evidencia de validación y lo que sigue pendiente.

## 1. Resumen

Se habilitó el flujo event-driven completo contra un broker Kafka local y Firestore real:

```text
evento Kafka -> Firestore -> scheduler -> correo console
```

El flujo quedó validado con un `IncidenteReportadoEvent`: se creó una alerta, dos notificaciones y el scheduler envió ambos correos simulados, dejando las notificaciones en `SENT`. Un segundo envío del mismo `evento_id` fue detectado como duplicado y no generó efectos nuevos. La suite de integración Kafka posterior quedó en 7/7.

## 2. Cambios aplicados

### 2.1 Broker local

- Se levantó `apache/kafka:3.9.0` en modo KRaft mediante Docker.
- Contenedor: `fleetops-kafka`.
- Puerto publicado: `9092`.
- Topics creados:
  - `fleetops.incident.incident.v1`
  - `fleetops.assignment.assignment.v1`
  - `fleetops.document.document.v1`
  - `fleetops.maintenance.maintenance.v1`
  - `fleetops.fuel.consumption.v1`
  - `fleetops.dlq.notification`

### 2.2 Configuración local

Se actualizó `.env` para usar el broker local:

```env
KAFKA_ENABLED=true
KAFKA_BROKERS=127.0.0.1:9092
KAFKA_SSL=false
READINESS_TIMEOUT_MS=10000
```

No se documentan ni versionan credenciales. El archivo `.env` sigue siendo local.

### 2.3 Scripts nuevos

Se añadieron comandos para reproducir la integración:

| Comando                     | Función                                                       |
| --------------------------- | ------------------------------------------------------------- |
| `npm run kafka:setup`       | Crea o valida los seis topics configurados.                   |
| `npm run kafka:publish`     | Publica un evento de prueba por escenario.                    |
| `npm run firestore:event`   | Consulta el evento procesado, la alerta y sus notificaciones. |
| `npm run firestore:cleanup` | Elimina los datos generados por un evento de prueba.          |
| `npm run firestore:indexes`       | Intenta desplegar los índices compuestos de Firestore.        |
| `npm run test:integration`        | Ejecuta la suite Kafka contra el broker local.                |
| `npm run test:integration:all`    | Ejecuta Kafka y Firestore en secuencia.                       |

Escenarios disponibles en `kafka:publish`:

```text
incident
assignment
document-expiring
document-expired
maintenance
invalid-envelope
invalid-data
```

También se puede reutilizar un `evento_id` para probar idempotencia:

```bash
npm run kafka:publish -- incident --event-id=<uuid>
```

### 2.4 Firestore

- Se crearon manualmente los 8 índices compuestos de `firestore.indexes.json`: 1 de despacho y 7 de listado/conteo.
- Los 8 índices están en estado `READY` y coinciden exactamente con las definiciones del archivo.
- La consulta del scheduler y las consultas de listado por `recipient_role`, `type`, `severity`, `dispatch_status`, `attention_status` y `reference_id` funcionan sin `FAILED_PRECONDITION`; el conteo de alertas críticas pendientes también fue validado.
- La cuenta de servicio sigue sin permiso para crear índices automáticamente (`403 PERMISSION_DENIED` con `npm run firestore:indexes`), pero los índices ya fueron creados desde la consola.

### 2.5 Suite de integración Kafka

Se añadió `test/integration/kafka.consumer.integration.test.js` y el wrapper `scripts/run-kafka-integration.js`. La suite se activa con `KAFKA_INTEGRATION=true` y usa topics y grupos únicos. Cubre:

- Reintento transitorio con commit manual.
- Agotamiento de reintentos y publicación en DLQ.
- Sobre inválido y datos inválidos en DLQ.
- Evento desconocido y contrato pendiente ignorados sin DLQ.
- Fallo al publicar en DLQ: el offset no se confirma y el evento se reprocesa al reiniciar.
- Reinicio sin reprocesar offsets confirmados.

### 2.6 Documentación

- `README.md`: requisitos, Kafka local con Docker, comandos nuevos y límites conocidos.
- `docs/estado-implementacion-fase-d.md`: estado del flujo Kafka, evidencia y limitaciones.
- `docs/pendientes-fase-d.md`: pendientes P0 actualizados y matriz de pruebas.
- Este documento: registro específico de los cambios de integración.

## 3. Evidencia de validación

| Verificación                  | Resultado                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `/ready` con Kafka habilitado | `200 READY`; `database.status = "UP"` y `broker.status = "UP"`.                       |
| Consumidor Kafka              | Conectado al grupo `notification-service`.                                            |
| Evento de incidente           | Procesado desde `fleetops.incident.incident.v1`.                                      |
| Alerta y notificaciones       | 1 alerta y 2 notificaciones creadas en Firestore.                                     |
| Scheduler                     | `claimed=2, sent=2, failed=0`.                                                        |
| Estado final                  | Ambas notificaciones en `SENT`, con `sent_at` y `provider_message_id`.                |
| Correo                        | Dos mensajes simulados por el proveedor `console`.                                    |
| Duplicado                     | Resultado `duplicate`; sin nuevos correos ni documentos.                              |
| DLQ: sobre inválido           | Publicado con `INVALID_ENVELOPE`.                                                     |
| DLQ: datos inválidos          | Publicado con `INVALID_EVENT_DATA`.                                                   |
| Handlers adicionales          | Asignación, documento próximo a vencer, documento vencido y mantenimiento procesados. |
| Limpieza                      | Datos de prueba eliminados de Firestore.                                              |
| Suite Kafka                   | `npm run test:integration`: 7/7 pruebas verdes contra el broker local.                |
| Calidad                       | `lint`, Prettier, 154 pruebas, 7 Kafka y 10 Firestore pasan.                           |

## 4. Cómo reproducir

Desde `notification-service/`:

```bash
# 1. Levantar Kafka local (ver README para el comando completo)
docker start fleetops-kafka
# 2. Crear los topics
npm run kafka:setup

# 3. Detener cualquier servicio local (npm run dev / npm start) y ejecutar
npm run test:integration
npm run test:integration:firestore
# o ambos en secuencia:
npm run test:integration:all

# 4. Arrancar el servicio
npm start

# 5. Publicar un evento
npm run kafka:publish -- incident

# 6. Consultar el resultado con el evento_id devuelto
npm run firestore:event -- <evento_id>

# 7. Limpiar los datos de prueba
npm run firestore:cleanup -- <evento_id>
```

El comando completo de `docker run` está en `README.md`, sección «Kafka local con Docker». El contenedor se detiene con:

```bash
docker stop fleetops-kafka
```

## 5. Pendientes después de estos cambios

1. Smoke con señales reales `SIGTERM`/`SIGINT` en Linux/CI; la lógica de cierre ya está cubierta por pruebas unitarias (P0-07).
2. Validar los tiempos reales de backoff `2 s`, `10 s` y `30 s` en un entorno de staging; la suite usa backoff acelerado y valida los defaults por configuración.
3. Smoke real de Resend cuando existan credenciales y dominio verificado; el adaptador ya se validó con servidor HTTP controlado.
4. Documentar combinaciones de filtros que requieran índices adicionales.

## 6. Observaciones

- Las publicaciones con KafkaJS `2.2.4` y Node 24 emiten `TimeoutNegativeWarning`; el flujo funcionó, pero conviene revisarlo al actualizar dependencias.
- Las suites de integración deben correr con el servicio local detenido y en secuencia. Si `npm run dev`/`npm start` sigue activo, su consumidor compite por el grupo de Kafka y su scheduler puede marcar `SENT` las notificaciones `PENDING_DISPATCH` de las pruebas Firestore.
- La integración usa únicamente recursos locales de desarrollo. No se agregó Docker Compose, Kubernetes ni pipeline de despliegue.
- Los datos de prueba se eliminaron; no quedaron alertas, notificaciones ni eventos de prueba en Firestore.
