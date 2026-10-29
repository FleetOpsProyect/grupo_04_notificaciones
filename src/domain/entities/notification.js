const {
  AcknowledgementStatus,
  ACKNOWLEDGEMENT_STATUS_VALUES,
  DeliveryStatus,
  DELIVERY_STATUS_VALUES,
  ORIGIN_VALUES,
  RECIPIENT_ROLE_VALUES,
  SEVERITY_VALUES,
  TYPE_VALUES,
} = require('../enums');
const { InvalidDataError, InvalidStateTransitionError } = require('../errors');

const assertEnum = (field, value, allowed) => {
  if (!allowed.includes(value)) {
    throw new InvalidDataError(`Valor inválido para ${field}: ${value}`);
  }
};

const assertDate = (field, value, { nullable = false } = {}) => {
  if (nullable && value === null) {
    return;
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidDataError(`Fecha inválida para ${field}`);
  }
};

class Notification {
  constructor({
    notification_id,
    alert_id,
    type,
    severity,
    recipient_role,
    recipient_email = null,
    subject,
    message,
    reference_id = null,
    origin,
    source_event_type = null,
    event_id = null,
    correlation_id,
    acknowledgement_status = AcknowledgementStatus.PENDING,
    acknowledged_at = null,
    delivery_status = DeliveryStatus.PENDING,
    delivery_attempts = 0,
    next_attempt_at,
    locked_until = null,
    failure_reason = null,
    provider_message_id = null,
    created_at,
    sent_at = null,
  }) {
    if (!notification_id || !alert_id) {
      throw new InvalidDataError('notification_id y alert_id son obligatorios');
    }
    if (!subject || !message) {
      throw new InvalidDataError('subject y message son obligatorios');
    }
    assertEnum('type', type, TYPE_VALUES);
    assertEnum('severity', severity, SEVERITY_VALUES);
    assertEnum('origin', origin, ORIGIN_VALUES);
    assertEnum('recipient_role', recipient_role, RECIPIENT_ROLE_VALUES);
    assertEnum('acknowledgement_status', acknowledgement_status, ACKNOWLEDGEMENT_STATUS_VALUES);
    assertEnum('delivery_status', delivery_status, DELIVERY_STATUS_VALUES);
    assertDate('created_at', created_at);
    assertDate('next_attempt_at', next_attempt_at, { nullable: true });
    assertDate('locked_until', locked_until, { nullable: true });
    assertDate('acknowledged_at', acknowledged_at, { nullable: true });
    assertDate('sent_at', sent_at, { nullable: true });

    if (!Number.isInteger(delivery_attempts) || delivery_attempts < 0) {
      throw new InvalidDataError('delivery_attempts debe ser un entero no negativo');
    }
    if (acknowledgement_status === AcknowledgementStatus.ACKNOWLEDGED && acknowledged_at === null) {
      throw new InvalidDataError(
        'acknowledged_at es obligatorio cuando la notificación fue reconocida',
      );
    }
    if (delivery_status === DeliveryStatus.SENT && sent_at === null) {
      throw new InvalidDataError('sent_at es obligatorio cuando delivery_status es SENT');
    }
    if (delivery_status === DeliveryStatus.PENDING && next_attempt_at === null) {
      throw new InvalidDataError(
        'next_attempt_at es obligatorio cuando delivery_status es PENDING',
      );
    }

    this.notification_id = notification_id;
    this.alert_id = alert_id;
    this.type = type;
    this.severity = severity;
    this.recipient_role = recipient_role;
    this.recipient_email = recipient_email;
    this.subject = subject;
    this.message = message;
    this.reference_id = reference_id;
    this.origin = origin;
    this.source_event_type = source_event_type;
    this.event_id = event_id;
    this.correlation_id = correlation_id;
    this.acknowledgement_status = acknowledgement_status;
    this.acknowledged_at = acknowledged_at;
    this.delivery_status = delivery_status;
    this.delivery_attempts = delivery_attempts;
    this.next_attempt_at = next_attempt_at;
    this.locked_until = locked_until;
    this.failure_reason = failure_reason;
    this.provider_message_id = provider_message_id;
    this.created_at = created_at;
    this.sent_at = sent_at;
  }

  isFinal() {
    return (
      this.delivery_status === DeliveryStatus.SENT || this.delivery_status === DeliveryStatus.FAILED
    );
  }

  claim(now, leaseMs) {
    if (this.delivery_status !== DeliveryStatus.PENDING) {
      return null;
    }
    if (this.next_attempt_at === null || this.next_attempt_at.getTime() > now.getTime()) {
      return null;
    }
    if (this.locked_until !== null && this.locked_until.getTime() > now.getTime()) {
      return null;
    }
    return new Notification({
      ...this,
      locked_until: new Date(now.getTime() + leaseMs),
    });
  }

  releaseClaim() {
    return new Notification({ ...this, locked_until: null });
  }

  markSent(now, providerMessageId) {
    assertDate('sent_at', now);
    if (this.delivery_status === DeliveryStatus.SENT) {
      return this;
    }
    if (this.delivery_status === DeliveryStatus.FAILED) {
      throw new InvalidStateTransitionError('No se puede enviar una notificación FAILED');
    }
    if (!providerMessageId) {
      throw new InvalidDataError('provider_message_id es obligatorio para marcar SENT');
    }
    return new Notification({
      ...this,
      delivery_status: DeliveryStatus.SENT,
      sent_at: now,
      next_attempt_at: null,
      locked_until: null,
      failure_reason: null,
      provider_message_id: providerMessageId,
    });
  }

  markFailed(now, reason, attempts = this.delivery_attempts + 1) {
    assertDate('failed_at', now);
    if (this.delivery_status === DeliveryStatus.FAILED) {
      return this;
    }
    if (this.delivery_status === DeliveryStatus.SENT) {
      throw new InvalidStateTransitionError('No se puede fallar una notificación SENT');
    }
    if (!reason) {
      throw new InvalidDataError('failure_reason es obligatorio para marcar FAILED');
    }
    return new Notification({
      ...this,
      delivery_status: DeliveryStatus.FAILED,
      delivery_attempts: attempts,
      next_attempt_at: null,
      locked_until: null,
      failure_reason: reason,
    });
  }

  scheduleRetry(nextAttemptAt, reason, attempts = this.delivery_attempts + 1) {
    assertDate('next_attempt_at', nextAttemptAt);
    if (this.delivery_status !== DeliveryStatus.PENDING) {
      throw new InvalidStateTransitionError('Solo se reprograma una notificación pendiente');
    }
    if (!reason) {
      throw new InvalidDataError('failure_reason es obligatorio para reprogramar');
    }
    return new Notification({
      ...this,
      delivery_attempts: attempts,
      next_attempt_at: nextAttemptAt,
      locked_until: null,
      failure_reason: reason,
    });
  }

  acknowledge(at) {
    assertDate('acknowledged_at', at);
    if (this.acknowledgement_status === AcknowledgementStatus.ACKNOWLEDGED) {
      return this;
    }
    return new Notification({
      ...this,
      acknowledgement_status: AcknowledgementStatus.ACKNOWLEDGED,
      acknowledged_at: at,
    });
  }
}

module.exports = { Notification };
