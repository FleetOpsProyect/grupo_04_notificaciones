const { safeErrorFields } = require('../../../application/shared/safe-log-fields');

const createKafkaDeadLetterPublisher = ({ producer, topic, clock }) => ({
  async publish({ originalMessage, reason, error, context = {} }) {
    const payload = {
      reason,
      error: safeErrorFields(error),
      topic: context.topic ?? null,
      partition: context.partition ?? null,
      offset: context.offset ?? null,
      failed_at: clock.now().toISOString(),
      original_message: originalMessage?.value?.toString('utf8') ?? null,
    };
    await producer.send({
      topic,
      messages: [
        {
          key: originalMessage?.key?.toString('utf8') ?? null,
          value: JSON.stringify(payload),
          headers: {
            'x-error-code': error?.code ?? 'UNKNOWN',
            'x-failed-at': payload.failed_at,
          },
        },
      ],
    });
  },
});

module.exports = { createKafkaDeadLetterPublisher };
