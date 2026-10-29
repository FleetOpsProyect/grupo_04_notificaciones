const { randomUUID } = require('node:crypto');

const EVENT_TYPES = Object.freeze({
  CREATED: 'notification_created_event',
  SENT: 'notification_sent_event',
  FAILED: 'notification_failed_event',
  ACKNOWLEDGED: 'notification_acknowledged_event',
});

const createOutboxRecord = ({
  eventType,
  notificationId,
  data,
  correlationId = null,
  createdAt,
  eventId = randomUUID(),
}) => ({
  event_id: eventId,
  event_type: eventType,
  data,
  notification_id: notificationId,
  status: 'PENDING',
  publish_attempts: 0,
  next_attempt_at: createdAt,
  created_at: createdAt,
  published_at: null,
  correlation_id: correlationId,
});

const buildCreatedEvent = (notification, { createdAt, correlationId } = {}) =>
  createOutboxRecord({
    eventType: EVENT_TYPES.CREATED,
    notificationId: notification.notification_id,
    correlationId: correlationId ?? notification.correlation_id ?? null,
    createdAt: createdAt ?? notification.created_at,
    data: {
      notification_id: notification.notification_id,
      alert_id: notification.alert_id,
      type: notification.type,
      severity: notification.severity,
      recipient_role: notification.recipient_role,
      reference_id: notification.reference_id ?? null,
      origin: notification.origin,
      source_event_id: notification.event_id ?? null,
      created_at: notification.created_at.toISOString(),
    },
  });

const buildSentEvent = (notification, { createdAt } = {}) =>
  createOutboxRecord({
    eventType: EVENT_TYPES.SENT,
    notificationId: notification.notification_id,
    correlationId: notification.correlation_id ?? null,
    createdAt: createdAt ?? notification.sent_at ?? notification.created_at,
    data: {
      notification_id: notification.notification_id,
      alert_id: notification.alert_id,
      sent_at: notification.sent_at.toISOString(),
      delivery_attempts: notification.delivery_attempts,
    },
  });

const buildFailedEvent = (notification, { createdAt } = {}) => {
  const failedAt = createdAt ?? notification.created_at;
  return createOutboxRecord({
    eventType: EVENT_TYPES.FAILED,
    notificationId: notification.notification_id,
    correlationId: notification.correlation_id ?? null,
    createdAt: failedAt,
    data: {
      notification_id: notification.notification_id,
      alert_id: notification.alert_id,
      failure_reason: notification.failure_reason,
      delivery_attempts: notification.delivery_attempts,
      failed_at: failedAt.toISOString(),
    },
  });
};

const buildAcknowledgedEvent = (notification, { acknowledgedAt, createdAt } = {}) => {
  const ackAt = acknowledgedAt ?? notification.acknowledged_at ?? notification.created_at;
  return createOutboxRecord({
    eventType: EVENT_TYPES.ACKNOWLEDGED,
    notificationId: notification.notification_id,
    correlationId: notification.correlation_id ?? null,
    createdAt: createdAt ?? ackAt,
    data: {
      notification_id: notification.notification_id,
      alert_id: notification.alert_id,
      severity: notification.severity,
      acknowledged_at: ackAt.toISOString(),
    },
  });
};

module.exports = {
  EVENT_TYPES,
  createOutboxRecord,
  buildCreatedEvent,
  buildSentEvent,
  buildFailedEvent,
  buildAcknowledgedEvent,
};
