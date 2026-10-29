const { safeErrorFields } = require('../shared/safe-log-fields');

const DEFAULT_RETRY_DELAYS_MS = Object.freeze([5000, 30000, 120000]);

const createPublishOutboxEventsUseCase = ({
  outboxRepository,
  eventPublisher,
  clock,
  logger,
  batchSize = 20,
  leaseMs = 30000,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  source = 'notification',
}) => {
  return async function publishOutboxEvents({ limit = batchSize } = {}) {
    const result = { claimed: 0, published: 0, failed: 0, skipped: false };
    if (!eventPublisher) {
      result.skipped = true;
      return result;
    }

    const now = clock.now();
    const claimed = await outboxRepository.claimBatch(now, limit, leaseMs);
    result.claimed = claimed.length;

    for (const record of claimed) {
      const envelope = {
        event_id: record.event_id,
        event_type: record.event_type,
        version: 1,
        occurred_at: record.created_at.toISOString(),
        source,
        ...(record.correlation_id ? { correlation_id: record.correlation_id } : {}),
        data: record.data,
      };

      try {
        await eventPublisher.publish(envelope, {
          groupId: record.notification_id,
          deduplicationId: record.event_id,
          messageAttributes: {
            event_type: record.event_type,
          },
        });
        await outboxRepository.markPublished(record.event_id, clock.now());
        result.published += 1;
      } catch (error) {
        const attemptIndex = Math.min(record.publish_attempts - 1, retryDelaysMs.length - 1);
        const delayMs = retryDelaysMs[Math.max(attemptIndex, 0)];
        await outboxRepository.markFailed(record.event_id, new Date(now.getTime() + delayMs));
        result.failed += 1;
        logger?.warn(
          {
            event_id: record.event_id,
            event_type: record.event_type,
            attempts: record.publish_attempts,
            ...safeErrorFields(error),
          },
          'No fue posible publicar el evento de outbox; se reprograma',
        );
      }
    }

    return result;
  };
};

module.exports = { createPublishOutboxEventsUseCase, DEFAULT_RETRY_DELAYS_MS };
