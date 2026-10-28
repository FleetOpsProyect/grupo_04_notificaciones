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
const { createConsoleEmailSender } = require('../adapters/out/email/console-email-sender');
const { createResendEmailSender } = require('../adapters/out/email/resend-email-sender');
const {
  createResilientEmailSender,
} = require('../adapters/out/email/resilient-email-sender.decorator');
const { createEnvRecipientDirectory } = require('../adapters/out/config/env-recipient.directory');
const { createKafkaClient } = require('../adapters/out/kafka/kafka.client');
const {
  createKafkaDeadLetterPublisher,
} = require('../adapters/out/kafka/kafka-dead-letter.publisher');
const { createKafkaEventConsumer } = require('../adapters/in/kafka/kafka-event.consumer');
const { createSqsClient } = require('../adapters/out/sqs/sqs.client');
const { createSnsClient } = require('../adapters/out/sns/sns.client');
const { createSqsDeadLetterPublisher } = require('../adapters/out/sqs/sqs-dead-letter.publisher');
const { createSnsEventPublisher } = require('../adapters/out/sns/sns-event.publisher');
const { createSqsEventConsumer } = require('../adapters/in/sqs/sqs-event.consumer');
const { createDispatchScheduler } = require('../adapters/in/scheduler/dispatch.scheduler');
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
  createMarkAlertAttendedUseCase,
} = require('../application/use-cases/mark-alert-attended.use-case');
const {
  createDispatchPendingNotificationsUseCase,
} = require('../application/use-cases/dispatch-pending-notifications.use-case');
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
  const markAlertAttended = createMarkAlertAttendedUseCase({ unitOfWork, clock });
  const dispatchPendingNotifications = createDispatchPendingNotificationsUseCase({
    notificationRepository,
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
    markAlertAttended,
  });

  const brokerType = config.broker?.type || (config.kafka.enabled ? 'kafka' : 'kafka');

  let kafkaClient = null;
  let kafkaProducer = null;
  let kafkaAdmin = null;
  let kafkaConsumer = null;
  let sqsClient = null;
  let sqsConsumer = null;
  let deadLetterPublisher = null;

  if (brokerType === 'sqs') {
    sqsClient = createSqsClient({
      region: config.aws.region,
      endpoint: config.aws.endpoint,
      credentials: config.aws.credentials,
    });
    const snsClientInstance = createSnsClient({
      region: config.aws.region,
      endpoint: config.aws.endpoint,
      credentials: config.aws.credentials,
    });
    if (config.sqs.dlqUrl) {
      deadLetterPublisher = createSqsDeadLetterPublisher({
        sqsClient,
        dlqUrl: config.sqs.dlqUrl,
        clock,
      });
    }
    if (config.sns.notificationTopicArn) {
      // Event publisher disponible para uso futuro (outbox)
      void createSnsEventPublisher({ snsClient: snsClientInstance, topicArn: config.sns.notificationTopicArn });
    }
    if (sqsClient && config.sqs.queueUrl) {
      sqsConsumer = createSqsEventConsumer({
        sqsClient,
        sqsConfig: config.sqs,
        queueUrl: config.sqs.queueUrl,
        processDomainEvent,
        deadLetterPublisher,
        logger,
        metrics,
      });
    }
  } else {
    kafkaClient = config.kafka.enabled ? createKafkaClient(config.kafka) : null;
    kafkaProducer = kafkaClient ? kafkaClient.producer() : null;
    kafkaAdmin = kafkaClient ? kafkaClient.admin() : null;
    deadLetterPublisher = kafkaProducer
      ? createKafkaDeadLetterPublisher({
          producer: kafkaProducer,
          topic: config.kafka.dlqTopic,
          clock,
        })
      : null;
    kafkaConsumer =
      kafkaClient && deadLetterPublisher
        ? createKafkaEventConsumer({
            kafka: kafkaClient,
            kafkaConfig: config.kafka,
            processDomainEvent,
            deadLetterPublisher,
            logger,
            metrics,
          })
        : null;
  }

  const readiness = createReadiness({
    databaseCheck: () => firestore.databaseCheck(),
    brokerCheck:
      brokerType === 'sqs'
        ? sqsClient && config.sqs.queueUrl
          ? async () => {
              const { GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
              const command = new GetQueueAttributesCommand({
                QueueUrl: config.sqs.queueUrl,
                AttributeNames: ['ApproximateNumberOfMessages'],
              });
              await sqsClient.send(command);
              return true;
            }
          : null
        : kafkaAdmin
        ? () => kafkaAdmin.describeCluster()
        : null,
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
    useCases: {
      processDomainEvent,
      createManualNotification,
      getNotificationStatus,
      listNotifications,
      getNotification,
      markAlertAttended,
      dispatchPendingNotifications,
    },
    app,
    scheduler,
    async start() {
      if (started) {
        return;
      }
      started = true;
      scheduler.start();
      if (brokerType === 'sqs') {
        if (sqsConsumer) {
          await sqsConsumer.start();
        }
      } else if (kafkaClient) {
        await kafkaProducer.connect();
        await kafkaAdmin.connect();
        await kafkaConsumer.start();
      }
      logger.info(
        {
          email_provider: config.email.provider,
          broker_type: brokerType,
          kafka_enabled: brokerType === 'kafka' ? config.kafka.enabled : false,
          sqs_enabled: brokerType === 'sqs' && Boolean(config.sqs.queueUrl),
        },
        'Dependencias inicializadas',
      );
    },
    async stop() {
      if (stopPromise) {
        return stopPromise;
      }

      stopPromise = (async () => {
        const closers = [() => scheduler.stop()];
        if (sqsConsumer) {
          closers.push(() => sqsConsumer.stop());
        }
        if (kafkaConsumer) {
          closers.push(() => kafkaConsumer.stop());
        }
        if (kafkaProducer) {
          closers.push(() => kafkaProducer.disconnect());
        }
        if (kafkaAdmin) {
          closers.push(() => kafkaAdmin.disconnect());
        }
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
