const { maskEmail } = require('./mask-email');
const { formatBogotaIso } = require('./time');

const toNotificationView = (notification, recipientEmail = null) => ({
  notification_id: notification.notification_id,
  alert_id: notification.alert_id,
  type: notification.type,
  severity: notification.severity,
  recipient_role: notification.recipient_role,
  recipient_email: maskEmail(recipientEmail ?? notification.recipient_email),
  subject: notification.subject,
  message: notification.message,
  reference_id: notification.reference_id,
  origin: notification.origin,
  source_event_type: notification.source_event_type,
  event_id: notification.event_id,
  correlation_id: notification.correlation_id,
  acknowledgement_status: notification.acknowledgement_status,
  acknowledged_at: formatBogotaIso(notification.acknowledged_at),
  delivery_status: notification.delivery_status,
  delivery_attempts: notification.delivery_attempts,
  next_attempt_at: formatBogotaIso(notification.next_attempt_at),
  locked_until: formatBogotaIso(notification.locked_until),
  failure_reason: notification.failure_reason,
  provider_message_id: notification.provider_message_id,
  created_at: formatBogotaIso(notification.created_at),
  sent_at: formatBogotaIso(notification.sent_at),
});

module.exports = { toNotificationView };
