const { Timestamp } = require('firebase-admin/firestore');
const { Notification } = require('../../../../domain/entities/notification');

const toDate = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  return typeof value.toDate === 'function' ? value.toDate() : new Date(value);
};

const toTimestamp = (value) => (value === null ? null : Timestamp.fromDate(value));

const notificationToDocument = (notification) => ({
  alert_id: notification.alert_id,
  type: notification.type,
  severity: notification.severity,
  recipient_role: notification.recipient_role,
  recipient_email: notification.recipient_email,
  subject: notification.subject,
  message: notification.message,
  reference_id: notification.reference_id,
  origin: notification.origin,
  source_event_type: notification.source_event_type,
  event_id: notification.event_id,
  correlation_id: notification.correlation_id,
  acknowledgement_status: notification.acknowledgement_status,
  acknowledged_at: toTimestamp(notification.acknowledged_at),
  delivery_status: notification.delivery_status,
  delivery_attempts: notification.delivery_attempts,
  next_attempt_at: toTimestamp(notification.next_attempt_at),
  locked_until: toTimestamp(notification.locked_until),
  failure_reason: notification.failure_reason,
  provider_message_id: notification.provider_message_id,
  created_at: toTimestamp(notification.created_at),
  sent_at: toTimestamp(notification.sent_at),
});

const documentToNotification = (id, data) =>
  new Notification({
    notification_id: id,
    alert_id: data.alert_id,
    type: data.type,
    severity: data.severity,
    recipient_role: data.recipient_role,
    recipient_email: data.recipient_email ?? null,
    subject: data.subject,
    message: data.message,
    reference_id: data.reference_id ?? null,
    origin: data.origin,
    source_event_type: data.source_event_type ?? null,
    event_id: data.event_id ?? null,
    correlation_id: data.correlation_id,
    acknowledgement_status: data.acknowledgement_status,
    acknowledged_at: toDate(data.acknowledged_at),
    delivery_status: data.delivery_status,
    delivery_attempts: data.delivery_attempts,
    next_attempt_at: toDate(data.next_attempt_at),
    locked_until: toDate(data.locked_until),
    failure_reason: data.failure_reason ?? null,
    provider_message_id: data.provider_message_id ?? null,
    created_at: toDate(data.created_at),
    sent_at: toDate(data.sent_at),
  });

module.exports = { notificationToDocument, documentToNotification, toDate, toTimestamp };
