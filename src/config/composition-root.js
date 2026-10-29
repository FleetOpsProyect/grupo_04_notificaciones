const { createLogger } = require('../observability/logger');
const { createMetrics } = require('../observability/metrics');
const { createReadiness } = require('../observability/readiness');
const { createFirestoreClient } = require('../adapters/out/firestore/firestore.client');
const { createFirestoreUnitOfWork } = require('../adapters/out/firestore/firestore.unit-of-work');
const {
  createAlertFirestoreRepository,
} = require('../adapters/out/firestore/alert.firestore.repository');
const {
  createNotificationFirestoreRepository,
} = require('../adapters/out/firestore/notification.firestore.repository');
const {
  createOutboxEventFirestoreRepository,
} = require('../adapters/out/firestore/outbox-event.firestore.repository');
const { createConsoleEmailSender } = require('../adapters/out/email/console-email-sender');
const { createResendEmailSender } = require('../adapters/out/email/resend-email-sender');
const {
  createResilientEmailSender,
} = require('../adapters/out/email/resilient-email-sender.decorator');
const { createEnvRecipientDirectory } = require('../adapters/out/config/env-recipient.directory');
const { GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const { createSqsClient } = require('../adapters/out/sqs/sqs.client');
const { createSnsClient } = require('../adapters/out/sns/sns.client');
const { createSqsDeadLetterPublisher } = require('../adapters/out/sqs/sqs-dead-letter.publisher');
const { createSnsEventPublisher } = require('../adapters/out/sns/sns-event.publisher');
const { createSqsEventConsumer } = require('../adapters/in/sqs/sqs-event.consumer');
const { createDispatchScheduler } = require('../adapters/in/scheduler/dispatch.scheduler');
const { createOutboxScheduler } = require('../adapters/in/scheduler/outbox.scheduler');
const { createEventHandlerRegistry } = require('../application/handlers/event-handler.registry');
const {
  createProcessDomainEventUseCase,
} = require('../application/use-cases/process-domain-event.use-case');
const {
  createCreateManualNotificationUseCase,
} = require('../application/use-cases/create-manual-notification.use-case');
const {
  createGetNotificationStatusUseCase,
} = require('../application/use-cases/get-notification-status.use-case');
const {
  createListNotificationsUseCase,
} = require('../application/use-cases/list-notifications.use-case');
const {
  createGetNotificationUseCase,
} = require('../application/use-cases/get-notification.use-case');
const {
  createAcknowledgeAlertUseCase,
} = require('../application/use-cases/acknowledge-alert.use-case');
const {
  createDispatchPendingNotificationsUseCase,
} = require('../application/use-cases/dispatch-pending-notifications.use-case');
const {
  createPublishOutboxEventsUseCase,
} = require('../application/use-cases/publish-outbox-events.use-case');
const {
  createNotificationController,
} = require('../adapters/in/http/controllers/notification.controller');
const { createApp } = require('../adapters/in/http/app');
const { loadOpenApiDocument } = require('../adapters/in/http/openapi');

const systemClock = { now: () => new Date() };

const createContainer = (config) => {
  const logger = createLogger({ level: config.logLevel, serviceName: config.serviceName });
  const metrics = createMetrics();
  const clock = systemClock;
  const firestore = createFirestoreClient(config);

  const alertRepository = createAlertFirestoreRepository(firestore.db);
  const notificationRepository = createNotificationFirestoreRepository(firestore.db);
  const outboxEventRepository = createOutboxEventFirestoreRepository(firestore.db);
  const unitOfWork = createFirestoreUnitOfWork(firestore.db);
  const registry = createEventHandlerRegistry();
  const recipientDirectory = createEnvRecipientDirectory({ recipients: config.recipients });

  const baseEmailSender =
    config.email.provider === 'resend'
      ? createResendEmailSender({ apiKey: config.email.apiKey, from: config.email.from })
      : createConsoleEmailSender({ logger });
  const emailSender = createResilientEmailSender({
    sender: baseEmailSender,
    timeoutMs: config.email.timeoutMs,
    circuitBreakerThreshold: config.email.circuitBreakerThreshold,
    circuitBreakerResetMs: config.email.circuitBreakerResetMs,
    metrics,
    logger,
  });

  const processDomainEvent = createProcessDomainEventUseCase({
    unitOfWork,
    registry,
    clock,
    metrics,
    logger,
  });
  const createManualNotification = createCreateManualNotificationUseCase({
    unitOfWork,
    clock,
    metrics,
  });
  const getNotificationStatus = createGetNotificationStatusUseCase({
    alertRepository,
    notificationRepository,
    clock,
  });
  const listNotifications = createListNotificationsUseCase({
    notificationRepository,
    recipientDirectory,
  });
  const getNotification = createGetNotificationUseCase({
    notificationRepository,
    recipientDirectory,
  });
  const acknowledgeAlert = createAcknowledgeAlertUseCase({ unitOfWork, clock });
  const dispatchPendingNotifications = createDispatchPendingNotificationsUseCase({
    notificationRepository,
    unitOfWork,
    recipientDirectory,
    emailSender,
    clock,
    metrics,
    logger,
    batchSize: config.dispatch.batchSize,
    leaseMs: config.dispatch.leaseMs,
    retryDelaysMs: config.email.retryDelaysMs,
    maxAttempts: config.email.maxAttempts,
  });

  const notificationController = createNotificationController({
    createManualNotification,
    getNotificationStatus,
    listNotifications,
    getNotification,
    acknowledgeAlert,
  });

  const sqsClient = createSqsClient({
    region: config.aws.region,
    endpoint: config.aws.endpoint,
    credentials: config.aws.credentials,
  });
  const snsClient = createSnsClient({
    region: config.aws.region,
    endpoint: config.aws.endpoint,
    credentials: config.aws.credentials,
  });

  const deadLetterPublisher = config.sqs.dlqUrl
    ? createSqsDeadLetterPublisher({
        sqsClient,
        dlqUrl: config.sqs.dlqUrl,
        clock,
      })
    : null;

  const eventPublisher = config.sns.notificationTopicArn
    ? createSnsEventPublisher({
        snsClient,
        topicArn: config.sns.notificationTopicArn,
      })
    : null;

  const sqsConsumer = createSqsEventConsumer({
    sqsClient,
    sqsConfig: config.sqs,
    queueUrl: config.sqs.queueUrl,
    processDomainEvent,
    deadLetterPublisher,
    logger,
    metrics,
  });

  const publishOutboxEvents = createPublishOutboxEventsUseCase({
    outboxRepository: outboxEventRepository,
    eventPublisher,
    clock,
    logger,
    batchSize: config.outbox.batchSize,
    leaseMs: config.outbox.leaseMs,
    retryDelaysMs: config.outbox.retryDelaysMs,
    source: config.serviceName,
  });

  const outboxScheduler = createOutboxScheduler({
    publishOutbox: () => publishOutboxEvents(),
    intervalMs: config.outbox.intervalMs,
    logger,
  });

  const readiness = createReadiness({
    databaseCheck: () => firestore.databaseCheck(),
    brokerCheck: async () => {
      await sqsClient.send(
        new GetQueueAttributesCommand({
          QueueUrl: config.sqs.queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        }),
      );
      return true;
    },
    emailProviderName: config.email.provider,
    timeoutMs: config.health.readinessTimeoutMs,
  });

  const app = createApp({
    notificationController,
    readiness,
    metrics,
    logger,
    enableSwagger: config.enableSwagger,
    openapiDocument: config.enableSwagger ? loadOpenApiDocument() : null,
  });

  const scheduler = createDispatchScheduler({
    dispatchPending: () => dispatchPendingNotifications(),
    intervalMs: config.dispatch.intervalMs,
    logger,
  });

  let started = false;
  let stopPromise = null;

  return {
    config,
    logger,
    metrics,
    clock,
    firestore,
    emailSender,
    unitOfWork,
    outboxEventRepository,
    broker: {
      type: 'sqs',
      deadLetterPublisher,
      eventPublisher,
    },
    useCases: {
      processDomainEvent,
      createManualNotification,
      getNotificationStatus,
      listNotifications,
      getNotification,
      acknowledgeAlert,
      dispatchPendingNotifications,
      publishOutboxEvents,
    },
    app,
    scheduler,
    outboxScheduler,
    async start() {
      if (started) {
        return;
      }
      if (!config.sqs.queueUrl) {
        throw new Error('SQS_QUEUE_URL no configurado');
      }
      started = true;
      scheduler.start();
      if (eventPublisher) {
        outboxScheduler.start();
      }
      await sqsConsumer.start();
      logger.info(
        {
          email_provider: config.email.provider,
          broker_type: 'sqs',
          event_publisher_enabled: Boolean(eventPublisher),
        },
        'Dependencias inicializadas',
      );
    },
    async stop() {
      if (stopPromise) {
        return stopPromise;
      }

      stopPromise = (async () => {
        const closers = [() => scheduler.stop(), () => outboxScheduler.stop()];
        if (sqsConsumer) {
          closers.push(() => sqsConsumer.stop());
        }
        closers.push(() => sqsClient.destroy());
        closers.push(() => snsClient.destroy());
        closers.push(() => firestore.close());

        const results = await Promise.allSettled(closers.map((close) => close()));
        const failure = results.find((result) => result.status === 'rejected');
        if (failure) {
          throw failure.reason;
        }
      })();

      return stopPromise;
    },
  };
};

module.exports = { createContainer, systemClock };
