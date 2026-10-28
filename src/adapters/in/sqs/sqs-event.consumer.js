const { InvalidDataError, ServiceUnavailableError } = require('../../../domain/errors');
const { safeErrorFields } = require('../../../application/shared/safe-log-fields');
const { runWithContext } = require('../../../observability/request-context');
const { mapSqsMessageToEnvelope } = require('./sqs-message.mapper');
const {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} = require('@aws-sdk/client-sqs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransient = (error) =>
  error instanceof ServiceUnavailableError ||
  error?.code === 'SERVICE_UNAVAILABLE' ||
  error?.transient === true;

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

  const sendToDeadLetter = async ({ originalMessage, reason, error, context }) => {
    if (deadLetterPublisher) {
      await deadLetterPublisher.publish({ originalMessage, reason, error, context });
    }
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

  const handlePermanentFailure = async ({
    originalMessage,
    reason,
    error,
    context,
    receiptHandle,
  }) => {
    await sendToDeadLetter({ originalMessage, reason, error, context });
    // Si hay DLQ configurada por redrive policy, también podemos dejar que expire; pero aquí intentamos publicar explícitamente
    if (receiptHandle && queueUrl) {
      try {
        // No borramos aquí para dejar que redrive policy actúe o podemos borrar tras publicar a DLQ manual
        // Para mantener trazabilidad similar a Kafka, borramos tras publicar a DLQ
        const deleteCommand = new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: receiptHandle,
        });
        await sqsClient.send(deleteCommand);
      } catch (deleteError) {
        logger?.error(
          { ...context, ...safeErrorFields(deleteError) },
          'No fue posible borrar mensaje tras enviar a DLQ',
        );
        throw deleteError;
      }
    }
  };

  const poll = async () => {
    while (running) {
      try {
        const receiveCommand = new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: sqsConfig.maxNumberOfMessages || 10,
          WaitTimeSeconds: sqsConfig.waitTimeSeconds || 20,
          MessageAttributeNames: ['All'],
          AttributeNames: ['All'],
        });
        const response = await sqsClient.send(receiveCommand);
        const messages = response.Messages || [];

        for (const message of messages) {
          if (!running) {
            break;
          }
          const context = { queue_url: queueUrl };
          let envelope;
          try {
            envelope = mapSqsMessageToEnvelope(message);
          } catch (error) {
            await handlePermanentFailure({
              originalMessage: message,
              reason: 'INVALID_ENVELOPE',
              error,
              context,
              receiptHandle: message.ReceiptHandle,
            });
            continue;
          }

          context.correlation_id = envelope.correlation_id;
          context.event_id = envelope.evento_id;
          context.event_type = envelope.tipo_evento;

          await runWithContext({ correlation_id: envelope.correlation_id }, async () => {
            const retryDelays = sqsConfig.consumerRetryDelaysMs || [2000, 10000, 30000];
            for (let attempt = 0; ; attempt += 1) {
              try {
                const result = await processDomainEvent(envelope, context);
                logger?.info(
                  {
                    ...context,
                    result: result?.status,
                  },
                  'Evento procesado',
                );
                const deleteCommand = new DeleteMessageCommand({
                  QueueUrl: queueUrl,
                  ReceiptHandle: message.ReceiptHandle,
                });
                await sqsClient.send(deleteCommand);
                return;
              } catch (error) {
                const transient = isTransient(error);
                const exhausted = attempt >= retryDelays.length;
                if (!transient || exhausted) {
                  try {
                    await handlePermanentFailure({
                      originalMessage: message,
                      reason: error instanceof InvalidDataError ? 'INVALID_EVENT_DATA' : 'PROCESSING_ERROR',
                      error,
                      context,
                      receiptHandle: message.ReceiptHandle,
                    });
                  } catch (dlqError) {
                    logger?.error(
                      { ...context, ...safeErrorFields(dlqError) },
                      'No fue posible publicar en la DLQ; no se borra el mensaje',
                    );
                    // No borrar para reintentar/redrive
                    throw dlqError;
                  }
                  return;
                }
                logger?.warn(
                  { ...context, attempt: attempt + 1, ...safeErrorFields(error) },
                  'Fallo transitorio; se reintenta el evento',
                );
                const delayMs = retryDelays[attempt];
                const visibilityTimeout = Math.min(Math.max(Math.ceil(delayMs / 1000), 1), 43200);
                try {
                  const visibilityCommand = new ChangeMessageVisibilityCommand({
                    QueueUrl: queueUrl,
                    ReceiptHandle: message.ReceiptHandle,
                    VisibilityTimeout: visibilityTimeout,
                  });
                  await sqsClient.send(visibilityCommand);
                } catch (visibilityError) {
                  logger?.warn(
                    { ...context, ...safeErrorFields(visibilityError) },
                    'No fue posible cambiar visibilidad; se esperará con sleep',
                  );
                  await sleep(delayMs);
                }
                await sleep(delayMs);
              }
            }
          });
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
  };
};

module.exports = { createSqsEventConsumer };
