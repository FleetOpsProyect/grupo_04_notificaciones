const { InvalidDataError, ServiceUnavailableError } = require('../../../domain/errors');
const { safeErrorFields } = require('../../../application/shared/safe-log-fields');
const { runWithContext } = require('../../../observability/request-context');
const { mapSqsMessageToEnvelope } = require('./sqs-message.mapper');
const {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} = require('@aws-sdk/client-sqs');

const DEFAULT_RETRY_DELAYS_MS = Object.freeze([2000, 10000, 30000]);
const DEFAULT_MAX_RECEIVE_COUNT = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransient = (error) =>
  error instanceof ServiceUnavailableError ||
  error?.code === 'SERVICE_UNAVAILABLE' ||
  error?.transient === true;

const receiveCountOf = (message) => {
  const value = Number(message?.Attributes?.ApproximateReceiveCount ?? 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
};

const createMessageHandler = ({
  sqsClient,
  sqsConfig,
  queueUrl,
  processDomainEvent,
  deadLetterPublisher,
  logger,
  metrics,
}) => {
  const retryDelaysMs = sqsConfig.consumerRetryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const maxReceiveCount = sqsConfig.maxReceiveCount ?? DEFAULT_MAX_RECEIVE_COUNT;

  const deleteMessage = async (receiptHandle) => {
    await sqsClient.send(
      new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }),
    );
  };

  const changeVisibility = async (receiptHandle, seconds) => {
    await sqsClient.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: seconds,
      }),
    );
  };

  const sendToDeadLetter = async ({ originalMessage, reason, error, context }) => {
    await deadLetterPublisher.publish({
      originalMessage,
      reason,
      error,
      context: { ...context, receive_count: context.receive_count },
    });
    metrics?.dlqMessages?.inc({ reason });
    logger?.error(
      {
        ...context,
        ...safeErrorFields(error),
        reason,
      },
      'Evento enviado a la DLQ',
    );
  };

  const handlePermanentFailure = async ({ originalMessage, reason, error, context }) => {
    await sendToDeadLetter({ originalMessage, reason, error, context });
    await deleteMessage(originalMessage.ReceiptHandle);
  };

  return async (message) => {
    const receiveCount = receiveCountOf(message);
    const context = {
      queue_url: queueUrl,
      message_id: message.MessageId ?? null,
      receive_count: receiveCount,
    };

    let envelope;
    try {
      envelope = mapSqsMessageToEnvelope(message);
    } catch (error) {
      await handlePermanentFailure({
        originalMessage: message,
        reason: 'INVALID_ENVELOPE',
        error,
        context,
      });
      return;
    }

    context.correlation_id = envelope.correlation_id;
    context.event_id = envelope.event_id;
    context.event_type = envelope.event_type;

    await runWithContext({ correlation_id: envelope.correlation_id }, async () => {
      try {
        const result = await processDomainEvent(envelope, context);
        logger?.info({ ...context, result: result?.status }, 'Evento procesado');
        await deleteMessage(message.ReceiptHandle);
      } catch (error) {
        if (!isTransient(error)) {
          await handlePermanentFailure({
            originalMessage: message,
            reason: error instanceof InvalidDataError ? 'INVALID_EVENT_DATA' : 'PROCESSING_ERROR',
            error,
            context,
          });
          return;
        }

        if (receiveCount >= maxReceiveCount) {
          await handlePermanentFailure({
            originalMessage: message,
            reason: 'MAX_RECEIVE_COUNT',
            error,
            context,
          });
          return;
        }

        const delayIndex = Math.min(receiveCount - 1, retryDelaysMs.length - 1);
        const delayMs = retryDelaysMs[Math.max(delayIndex, 0)];
        const visibilityTimeout = Math.max(Math.ceil(delayMs / 1000), 1);
        logger?.warn(
          {
            ...context,
            retry_in_seconds: visibilityTimeout,
            ...safeErrorFields(error),
          },
          'Fallo transitorio; se reprograma la visibilidad del mensaje',
        );
        await changeVisibility(message.ReceiptHandle, visibilityTimeout);
      }
    });
  };
};

const createSqsEventConsumer = ({
  sqsClient,
  sqsConfig,
  queueUrl,
  processDomainEvent,
  deadLetterPublisher,
  logger,
  metrics,
}) => {
  let running = false;
  let pollPromise = null;

  const handleMessage = createMessageHandler({
    sqsClient,
    sqsConfig,
    queueUrl,
    processDomainEvent,
    deadLetterPublisher,
    logger,
    metrics,
  });

  const poll = async () => {
    while (running) {
      try {
        const receiveCommand = new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: sqsConfig.maxNumberOfMessages || 10,
          WaitTimeSeconds: sqsConfig.waitTimeSeconds || 20,
          VisibilityTimeout: sqsConfig.visibilityTimeoutSeconds,
          MessageAttributeNames: ['All'],
          AttributeNames: ['All'],
        });
        const response = await sqsClient.send(receiveCommand);
        const messages = response.Messages || [];

        for (const message of messages) {
          if (!running) {
            break;
          }
          try {
            await handleMessage(message);
          } catch (error) {
            logger?.error(
              { ...safeErrorFields(error), message_id: message.MessageId ?? null },
              'No fue posible manejar el mensaje; quedará visible tras el timeout',
            );
          }
        }
      } catch (error) {
        logger?.error({ ...safeErrorFields(error) }, 'Error en polling SQS');
        await sleep(1000);
      }
    }
  };

  return {
    async start() {
      if (running) {
        return;
      }
      if (!queueUrl) {
        throw new Error('SQS_QUEUE_URL no configurado');
      }
      running = true;
      pollPromise = poll();
      logger?.info({ queue_url: queueUrl }, 'Consumidor SQS iniciado');
    },
    async stop() {
      running = false;
      if (pollPromise) {
        await pollPromise.catch(() => {});
      }
    },
    handleMessage,
  };
};

module.exports = {
  createSqsEventConsumer,
  createMessageHandler,
  DEFAULT_RETRY_DELAYS_MS,
  DEFAULT_MAX_RECEIVE_COUNT,
};
