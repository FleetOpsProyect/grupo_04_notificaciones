const { randomUUID } = require('node:crypto');
const { Alert } = require('../../domain/entities/alert');
const { Notification } = require('../../domain/entities/notification');
const {
  AcknowledgementStatus,
  DeliveryStatus,
  Origin,
  RecipientRole,
} = require('../../domain/enums');
const { InvalidDataError } = require('../../domain/errors');
const { buildManualNotificationTemplate } = require('../templates/manual-notification.template');
const { formatBogotaIso } = require('../shared/time');

const createCreateManualNotificationUseCase = ({
  unitOfWork,
  clock,
  metrics,
  idGenerator = randomUUID,
}) => {
  return async function createManualNotification(input) {
    if (input.recipient_role === RecipientRole.EMPLOYEE) {
      throw new InvalidDataError('El POST manual no admite el rol EMPLOYEE');
    }

    const now = clock.now();
    const alertId = idGenerator();
    const notificationId = idGenerator();
    const template = buildManualNotificationTemplate({
      type: input.type,
      severity: input.severity,
      message: input.message,
      referenceId: input.reference_id,
      createdAt: now,
    });

    const alert = new Alert({
      alert_id: alertId,
      origin: Origin.MANUAL,
      source_event_type: null,
      event_id: null,
      type: input.type,
      severity: input.severity,
      reference_id: input.reference_id ?? null,
      acknowledgement_status: AcknowledgementStatus.PENDING,
      acknowledged_at: null,
      correlation_id: input.correlation_id,
      created_at: now,
    });

    const notification = new Notification({
      notification_id: notificationId,
      alert_id: alertId,
      type: input.type,
      severity: input.severity,
      recipient_role: input.recipient_role,
      recipient_email: null,
      subject: template.subject,
      message: template.message,
      reference_id: input.reference_id ?? null,
      origin: Origin.MANUAL,
      source_event_type: null,
      event_id: null,
      correlation_id: input.correlation_id,
      acknowledgement_status: AcknowledgementStatus.PENDING,
      acknowledged_at: null,
      delivery_status: DeliveryStatus.PENDING,
      delivery_attempts: 0,
      next_attempt_at: now,
      locked_until: null,
      failure_reason: null,
      provider_message_id: null,
      created_at: now,
      sent_at: null,
    });

    await unitOfWork.run(async (transaction) => {
      await transaction.alerts.create(alert);
      await transaction.notifications.createMany([notification]);
    });

    metrics?.notificationsCreated?.inc({
      type: input.type,
      severity: input.severity,
    });

    return {
      notification_id: notificationId,
      alert_id: alertId,
      delivery_status: DeliveryStatus.PENDING,
      created_at: formatBogotaIso(now),
    };
  };
};

module.exports = { createCreateManualNotificationUseCase };
