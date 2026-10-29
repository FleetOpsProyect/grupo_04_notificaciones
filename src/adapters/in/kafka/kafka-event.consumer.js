const { InvalidDataError, ServiceUnavailableError } = require('../../../domain/errors');
const { safeErrorFields } = require('../../../application/shared/safe-log-fields');
const { runWithContext } = require('../../../observability/request-context');
const { parseEventEnvelope } = require('../shared/event-envelope');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransient = (error) =>
  error instanceof ServiceUnavailableError ||
  error?.code === 'SERVICE_UNAVAILABLE' ||
  error?.transient === true;

const createKafkaEventConsumer = ({
  kafka,
  kafkaConfig,
  processDomainEvent,
  deadLetterPublisher,
  logger,
  metrics,
}) => {
  const consumer = kafka.consumer({
    groupId: kafkaConfig.groupId,
    sessionTimeout: Math.max(kafkaConfig.consumerHeartbeatMs * 3, 10000),
    heartbeatInterval: kafkaConfig.consumerHeartbeatMs,
  });
  const topics = Object.values(kafkaConfig.topics);

  const commit = (topic, partition, offset) =>
    consumer.commitOffsets([{ topic, partition, offset: (BigInt(offset) + 1n).toString() }]);

  const sendToDeadLetter = async ({ originalMessage, reason, error, context }) => {
    await deadLetterPublisher.publish({ originalMessage, reason, error, context });
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
    topic,
    partition,
    offset,
  }) => {
    await sendToDeadLetter({ originalMessage, reason, error, context });
    await commit(topic, partition, offset);
  };

  return {
    async start() {
      await consumer.connect();
      await consumer.subscribe({ topics, fromBeginning: false });
      await consumer.run({
        autoCommit: false,
        eachMessage: async ({ topic, partition, message, heartbeat }) => {
          const context = { topic, partition, offset: message.offset };
          let envelope;
          try {
            envelope = parseEventEnvelope(message.value);
          } catch (error) {
            await handlePermanentFailure({
              originalMessage: message,
              reason: 'INVALID_ENVELOPE',
              error,
              context,
              topic,
              partition,
              offset: message.offset,
            });
            return;
          }

          context.correlation_id = envelope.correlation_id;
          context.event_id = envelope.event_id;
          context.event_type = envelope.event_type;

          await runWithContext({ correlation_id: envelope.correlation_id }, async () => {
            for (let attempt = 0; ; attempt += 1) {
              try {
                const result = await processDomainEvent(envelope, {
                  topic,
                  partition,
                  offset: message.offset,
                });
                logger?.info(
                  {
                    ...context,
                    result: result.status,
                  },
                  'Evento procesado',
                );
                await commit(topic, partition, message.offset);
                return;
              } catch (error) {
                const transient = isTransient(error);
                const exhausted = attempt >= kafkaConfig.consumerRetryDelaysMs.length;
                if (!transient || exhausted) {
                  try {
                    await handlePermanentFailure({
                      originalMessage: message,
                      reason:
                        error instanceof InvalidDataError
                          ? 'INVALID_EVENT_DATA'
                          : 'PROCESSING_ERROR',
                      error,
                      context,
                      topic,
                      partition,
                      offset: message.offset,
                    });
                  } catch (dlqError) {
                    logger?.error(
                      { ...context, ...safeErrorFields(dlqError) },
                      'No fue posible publicar en la DLQ; no se confirma el offset',
                    );
                    throw dlqError;
                  }
                  return;
                }
                logger?.warn(
                  { ...context, attempt: attempt + 1, ...safeErrorFields(error) },
                  'Fallo transitorio; se reintenta el evento',
                );
                await sleep(kafkaConfig.consumerRetryDelaysMs[attempt]);
                await heartbeat();
              }
            }
          });
        },
      });
      logger?.info({ topics, group_id: kafkaConfig.groupId }, 'Consumidor Kafka iniciado');
    },

    async stop() {
      await consumer.disconnect();
    },
  };
};

module.exports = { createKafkaEventConsumer, isTransient };
