const { createInMemoryUnitOfWork } = require('./in-memory');
const {
  createEventHandlerRegistry,
} = require('../../src/application/handlers/event-handler.registry');
const {
  createProcessDomainEventUseCase,
} = require('../../src/application/use-cases/process-domain-event.use-case');
const {
  createCreateManualNotificationUseCase,
} = require('../../src/application/use-cases/create-manual-notification.use-case');
const {
  createGetNotificationStatusUseCase,
} = require('../../src/application/use-cases/get-notification-status.use-case');
const {
  createListNotificationsUseCase,
} = require('../../src/application/use-cases/list-notifications.use-case');
const {
  createGetNotificationUseCase,
} = require('../../src/application/use-cases/get-notification.use-case');
const {
  createAcknowledgeAlertUseCase,
} = require('../../src/application/use-cases/acknowledge-alert.use-case');
const {
  createDispatchPendingNotificationsUseCase,
} = require('../../src/application/use-cases/dispatch-pending-notifications.use-case');
const {
  createEnvRecipientDirectory,
} = require('../../src/adapters/out/config/env-recipient.directory');

const FIXED_NOW = new Date('2026-10-22T15:00:00.000Z');

const createFixedClock = (value = FIXED_NOW) => ({
  now: () => new Date(value.getTime()),
});

const createSilentLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createTestMetrics = () => ({
  notificationsCreated: { inc: jest.fn() },
  deliveryTotal: { inc: jest.fn() },
  eventsProcessed: { inc: jest.fn() },
  dlqMessages: { inc: jest.fn() },
  setCircuitBreakerState: jest.fn(),
});

const createTestContext = ({
  clock = createFixedClock(),
  emailSender = { send: jest.fn().mockResolvedValue({ provider_message_id: 'provider-1' }) },
  metrics = createTestMetrics(),
  logger = createSilentLogger(),
  unitOfWork = createInMemoryUnitOfWork(),
  recipients = {
    FLEET_ADMINISTRATOR: 'admin@example.com',
    MAINTENANCE_TECHNICIAN: 'tecnico@example.com',
    MANAGEMENT: 'gerencia@example.com',
  },
} = {}) => {
  let sequence = 0;
  const idGenerator = () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  };
  const registry = createEventHandlerRegistry();
  const recipientDirectory = createEnvRecipientDirectory({ recipients });
  const repositories = unitOfWork.repositories;

  const processDomainEvent = createProcessDomainEventUseCase({
    unitOfWork,
    registry,
    clock,
    metrics,
    logger,
    idGenerator,
  });
  const createManualNotification = createCreateManualNotificationUseCase({
    unitOfWork,
    clock,
    metrics,
    idGenerator,
  });
  const getNotificationStatus = createGetNotificationStatusUseCase({
    alertRepository: repositories.alerts,
    notificationRepository: repositories.notifications,
    clock,
  });
  const listNotifications = createListNotificationsUseCase({
    notificationRepository: repositories.notifications,
    recipientDirectory,
  });
  const getNotification = createGetNotificationUseCase({
    notificationRepository: repositories.notifications,
    recipientDirectory,
  });
  const acknowledgeAlert = createAcknowledgeAlertUseCase({ unitOfWork, clock });
  const dispatchPendingNotifications = createDispatchPendingNotificationsUseCase({
    notificationRepository: repositories.notifications,
    recipientDirectory,
    emailSender,
    clock,
    metrics,
    logger,
    batchSize: 20,
    leaseMs: 60000,
    retryDelaysMs: [30000, 120000, 600000],
    maxAttempts: 4,
  });

  return {
    clock,
    emailSender,
    metrics,
    logger,
    unitOfWork,
    state: unitOfWork.state,
    repositories,
    recipientDirectory,
    registry,
    useCases: {
      processDomainEvent,
      createManualNotification,
      getNotificationStatus,
      listNotifications,
      getNotification,
      acknowledgeAlert,
      dispatchPendingNotifications,
    },
  };
};

const eventEnvelope = (overrides = {}) => ({
  event_id: '11111111-1111-4111-8111-111111111111',
  event_type: 'severe_incident_reported_event',
  version: 1,
  occurred_at: '2026-10-22T14:55:00.000Z',
  source: 'incident-service',
  correlation_id: '22222222-2222-4222-8222-222222222222',
  data: {
    incidente_id: 'INC-001',
    vehiculo_id: 'VEH-001',
    tipo_incidente: 'Choque',
    requiere_asistencia: true,
    fecha_reporte: '2026-10-22T14:50:00.000Z',
  },
  ...overrides,
});

module.exports = {
  FIXED_NOW,
  createFixedClock,
  createSilentLogger,
  createTestMetrics,
  createTestContext,
  eventEnvelope,
};
