const { randomUUID } = require('node:crypto');
const { Alert } = require('../../domain/entities/alert');
const { Notification } = require('../../domain/entities/notification');
const { AcknowledgementStatus, DeliveryStatus, Origin } = require('../../domain/enums');
const { safeNotificationLogFields } = require('../shared/safe-log-fields');
const { buildCreatedEvent } = require('../shared/notification-events');

const PROCESSED_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const createProcessDomainEventUseCase = ({
  unitOfWork,
  registry,
  clock,
  metrics,
  logger,
  idGenerator = randomUUID,
}) => {
  return async function processDomainEvent(envelope, context = {}) {
    const handler = registry.resolve(envelope.event_type);
    if (!handler) {
      metrics?.eventsProcessed?.inc({ event_type: envelope.event_type, result: 'IGNORED' });
      return { status: 'ignored', reason: 'unsupported_event_type' };
    }

    const plan = handler.buildPlan(envelope, context);
    if (plan === null) {
      logger?.info(
        { event_id: envelope.event_id, event_type: envelope.event_type },
        'Evento sin aviso definido; no se persiste',
      );
      metrics?.eventsProcessed?.inc({ event_type: envelope.event_type, result: 'IGNORED' });
      return { status: 'ignored', reason: 'no_notification_defined' };
    }

    const result = await unitOfWork.run(async (transaction) => {
      const alreadyProcessed = await transaction.processedEvents.exists(envelope.event_id);
      if (alreadyProcessed) {
        return { status: 'duplicate', event_id: envelope.event_id };
      }

      const now = clock.now();
      const alertId = idGenerator();
      const alert = new Alert({
        alert_id: alertId,
        origin: Origin.EVENT,
        source_event_type: envelope.event_type,
        event_id: envelope.event_id,
        type: plan.alert.type,
        severity: plan.alert.severity,
        reference_id: plan.alert.reference_id ?? null,
        acknowledgement_status: AcknowledgementStatus.PENDING,
        acknowledged_at: null,
        correlation_id: envelope.correlation_id,
        created_at: now,
      });
      await transaction.alerts.create(alert);

      const notifications = plan.notifications.map((item) => {
        const notification = new Notification({
          notification_id: idGenerator(),
          alert_id: alertId,
          type: plan.alert.type,
          severity: plan.alert.severity,
          recipient_role: item.recipient_role,
          recipient_email: item.recipient_email ?? null,
          subject: item.subject,
          message: item.message,
          reference_id: item.reference_id ?? plan.alert.reference_id ?? null,
          origin: Origin.EVENT,
          source_event_type: envelope.event_type,
          event_id: envelope.event_id,
          correlation_id: envelope.correlation_id,
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
        logger?.debug(safeNotificationLogFields(notification), 'Notificación creada por evento');
        return notification;
      });
      await transaction.notifications.createMany(notifications);
      for (const notification of notifications) {
        await transaction.outboxEvents.create(
          buildCreatedEvent(notification, {
            createdAt: now,
            correlationId: envelope.correlation_id,
          }),
        );
      }
      await transaction.processedEvents.create({
        event_id: envelope.event_id,
        event_type: envelope.event_type,
        source: envelope.source,
        message_id: context.message_id ?? null,
        queue_url: context.queue_url ?? null,
        occurred_at: new Date(envelope.occurred_at),
        processed_at: now,
        expires_at: new Date(now.getTime() + PROCESSED_EVENT_TTL_MS),
      });

      return {
        status: 'processed',
        event_id: envelope.event_id,
        alert_id: alertId,
        notification_ids: notifications.map((item) => item.notification_id),
      };
    });

    metrics?.eventsProcessed?.inc({
      event_type: envelope.event_type,
      result: result.status === 'duplicate' ? 'DUPLICATE' : 'OK',
    });
    return result;
  };
};

module.exports = { createProcessDomainEventUseCase, PROCESSED_EVENT_TTL_MS };
