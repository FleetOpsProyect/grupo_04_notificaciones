const { randomUUID } = require('node:crypto');
const { Alert } = require('../../domain/entities/alert');
const { Notification } = require('../../domain/entities/notification');
const { AttentionStatus, DispatchStatus, Origin } = require('../../domain/enums');
const { safeNotificationLogFields } = require('../shared/safe-log-fields');

const createProcessDomainEventUseCase = ({
  unitOfWork,
  registry,
  clock,
  metrics,
  logger,
  idGenerator = randomUUID,
}) => {
  return async function processDomainEvent(envelope, context = {}) {
    const handler = registry.resolve(envelope.tipo_evento);
    if (!handler) {
      metrics?.eventsProcessed?.inc({ event_type: envelope.tipo_evento, result: 'IGNORED' });
      return { status: 'ignored', reason: 'unsupported_event_type' };
    }

    const plan = handler.buildPlan(envelope, context);
    if (plan === null) {
      logger?.info(
        { event_id: envelope.evento_id, event_type: envelope.tipo_evento },
        'Evento registrado como contrato pendiente; no se persiste',
      );
      metrics?.eventsProcessed?.inc({ event_type: envelope.tipo_evento, result: 'IGNORED' });
      return { status: 'ignored', reason: 'pending_contract' };
    }

    const result = await unitOfWork.run(async (transaction) => {
      const alreadyProcessed = await transaction.processedEvents.exists(envelope.evento_id);
      if (alreadyProcessed) {
        return { status: 'duplicate', event_id: envelope.evento_id };
      }

      const now = clock.now();
      const alertId = idGenerator();
      const alert = new Alert({
        alert_id: alertId,
        origin: Origin.EVENT,
        source_event_type: envelope.tipo_evento,
        event_id: envelope.evento_id,
        type: plan.alert.type,
        severity: plan.alert.severity,
        reference_id: plan.alert.reference_id ?? null,
        attention_status: AttentionStatus.PENDING,
        attended_at: null,
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
          source_event_type: envelope.tipo_evento,
          event_id: envelope.evento_id,
          correlation_id: envelope.correlation_id,
          attention_status: AttentionStatus.PENDING,
          attended_at: null,
          dispatch_status: DispatchStatus.PENDING_DISPATCH,
          dispatch_attempts: 0,
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
      await transaction.processedEvents.create({
        evento_id: envelope.evento_id,
        event_type: envelope.tipo_evento,
        source: envelope.origen,
        topic: context.topic ?? null,
        partition: context.partition ?? null,
        offset: context.offset ?? null,
        occurred_at: new Date(envelope.fecha_evento),
        processed_at: now,
      });

      return {
        status: 'processed',
        event_id: envelope.evento_id,
        alert_id: alertId,
        notification_ids: notifications.map((item) => item.notification_id),
      };
    });

    metrics?.eventsProcessed?.inc({
      event_type: envelope.tipo_evento,
      result: result.status === 'duplicate' ? 'DUPLICATE' : 'OK',
    });
    return result;
  };
};

module.exports = { createProcessDomainEventUseCase };
