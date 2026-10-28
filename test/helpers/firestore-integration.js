const { randomUUID } = require('node:crypto');
const { config } = require('../../src/config/env');
const { createFirestoreClient } = require('../../src/adapters/out/firestore/firestore.client');
const {
  createFirestoreUnitOfWork,
} = require('../../src/adapters/out/firestore/firestore.unit-of-work');
const {
  createAlertFirestoreRepository,
} = require('../../src/adapters/out/firestore/alert.firestore.repository');
const {
  createNotificationFirestoreRepository,
} = require('../../src/adapters/out/firestore/notification.firestore.repository');
const {
  createProcessedEventFirestoreRepository,
} = require('../../src/adapters/out/firestore/processed-event.firestore.repository');
const {
  createProcessDomainEventUseCase,
} = require('../../src/application/use-cases/process-domain-event.use-case');
const {
  createMarkAlertAttendedUseCase,
} = require('../../src/application/use-cases/mark-alert-attended.use-case');
const {
  createEventHandlerRegistry,
} = require('../../src/application/handlers/event-handler.registry');
const { Alert } = require('../../src/domain/entities/alert');
const { Notification } = require('../../src/domain/entities/notification');
const {
  AttentionStatus,
  DispatchStatus,
  Origin,
  RecipientRole,
  Severity,
  Type,
} = require('../../src/domain/enums');

const runId = `it-${Date.now()}-${randomUUID().slice(0, 8)}`;
const silentLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};
const noopMetrics = {
  eventsProcessed: { inc() {} },
  notificationsCreated: { inc() {} },
  dispatchTotal: { inc() {} },
  dlqMessages: { inc() {} },
  setCircuitBreakerState() {},
};

const createFirestoreIntegrationContext = () => {
  const client = createFirestoreClient(config);
  const db = client.db;
  const unitOfWork = createFirestoreUnitOfWork(db);
  const repositories = {
    alerts: createAlertFirestoreRepository(db),
    notifications: createNotificationFirestoreRepository(db),
    processedEvents: createProcessedEventFirestoreRepository(db),
  };
  const created = {
    alerts: new Set(),
    notifications: new Set(),
    processedEvents: new Set(),
  };
  const clock = { now: () => new Date() };
  const registry = createEventHandlerRegistry();
  const processDomainEventUseCase = createProcessDomainEventUseCase({
    unitOfWork,
    registry,
    clock,
    metrics: noopMetrics,
    logger: silentLogger,
  });
  const markAlertAttendedUseCase = createMarkAlertAttendedUseCase({ unitOfWork, clock });

  const trackAlert = (id) => created.alerts.add(id);
  const trackNotification = (id) => created.notifications.add(id);
  const trackProcessedEvent = (id) => created.processedEvents.add(id);

  const processDomainEvent = async (envelope, context = {}) => {
    const result = await processDomainEventUseCase(envelope, context);
    if (result.alert_id) {
      trackAlert(result.alert_id);
    }
    for (const notificationId of result.notification_ids ?? []) {
      trackNotification(notificationId);
    }
    if (result.event_id) {
      trackProcessedEvent(result.event_id);
    }
    return result;
  };

  const markAlertAttended = (notificationId) => markAlertAttendedUseCase(notificationId);

  const createAlert = (overrides = {}) => {
    const alertId = randomUUID();
    trackAlert(alertId);
    return new Alert({
      alert_id: alertId,
      origin: Origin.EVENT,
      source_event_type: 'IncidenteReportadoEvent',
      event_id: randomUUID(),
      type: Type.INCIDENT,
      severity: Severity.CRITICAL,
      reference_id: runId,
      attention_status: AttentionStatus.PENDING,
      attended_at: null,
      correlation_id: randomUUID(),
      created_at: new Date(),
      ...overrides,
    });
  };

  const createNotification = (overrides = {}) => {
    const notificationId = randomUUID();
    trackNotification(notificationId);
    return new Notification({
      notification_id: notificationId,
      alert_id: randomUUID(),
      type: Type.INCIDENT,
      severity: Severity.CRITICAL,
      recipient_role: RecipientRole.FLEET_ADMINISTRATOR,
      recipient_email: null,
      subject: 'Asunto de integración',
      message: 'Mensaje de integración',
      reference_id: runId,
      origin: Origin.EVENT,
      source_event_type: 'IncidenteReportadoEvent',
      event_id: randomUUID(),
      correlation_id: randomUUID(),
      attention_status: AttentionStatus.PENDING,
      attended_at: null,
      dispatch_status: DispatchStatus.PENDING_DISPATCH,
      dispatch_attempts: 0,
      next_attempt_at: new Date(),
      locked_until: null,
      failure_reason: null,
      provider_message_id: null,
      created_at: new Date(),
      sent_at: null,
      ...overrides,
    });
  };

  const makeIncidentEnvelope = (overrides = {}) => ({
    evento_id: randomUUID(),
    tipo_evento: 'IncidenteReportadoEvent',
    version: 1,
    fecha_evento: new Date().toISOString(),
    origen: 'incident-service',
    correlation_id: randomUUID(),
    datos: {
      incidente_id: `INC-${runId}`,
      vehiculo_id: 'VEH-IT',
      tipo_incidente: 'Choque',
      requiere_asistencia: true,
      fecha_reporte: new Date().toISOString(),
    },
    ...overrides,
  });

  const deleteDocuments = async (collectionName, ids) => {
    const values = [...ids];
    for (let index = 0; index < values.length; index += 400) {
      const batch = db.batch();
      for (const id of values.slice(index, index + 400)) {
        batch.delete(db.collection(collectionName).doc(id));
      }
      await batch.commit();
    }
    ids.clear();
  };

  const cleanup = async () => {
    await deleteDocuments('alerts', created.alerts);
    await deleteDocuments('notifications', created.notifications);
    await deleteDocuments('processed_events', created.processedEvents);
  };

  return {
    client,
    db,
    unitOfWork,
    repositories,
    created,
    runId,
    processDomainEvent,
    markAlertAttended,
    createAlert,
    createNotification,
    makeIncidentEnvelope,
    trackAlert,
    trackNotification,
    trackProcessedEvent,
    cleanup,
  };
};

module.exports = { createFirestoreIntegrationContext, runId };
