const { maskEmail, maskEmailsInText } = require('./mask-email');

const safeNotificationLogFields = (notification) => ({
  notification_id: notification.notification_id,
  alert_id: notification.alert_id,
  type: notification.type,
  severity: notification.severity,
  recipient_role: notification.recipient_role,
  recipient_email: maskEmail(notification.recipient_email),
  delivery_status: notification.delivery_status,
  event_id: notification.event_id,
  correlation_id: notification.correlation_id,
});

const safeErrorFields = (error) => ({
  error_name: error?.name ?? 'UnknownError',
  error_code: error?.code ?? 'UNKNOWN',
  error_message: maskEmailsInText(error?.message) ?? 'Error desconocido',
});

module.exports = { safeNotificationLogFields, safeErrorFields };
