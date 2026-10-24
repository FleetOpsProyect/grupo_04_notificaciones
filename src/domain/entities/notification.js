const {
  AttentionStatus,
  ATTENTION_STATUS_VALUES,
  DispatchStatus,
  DISPATCH_STATUS_VALUES,
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
    attention_status = AttentionStatus.PENDING,
    attended_at = null,
    dispatch_status = DispatchStatus.PENDING_DISPATCH,
    dispatch_attempts = 0,
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
    assertEnum('attention_status', attention_status, ATTENTION_STATUS_VALUES);
    assertEnum('dispatch_status', dispatch_status, DISPATCH_STATUS_VALUES);
    assertDate('created_at', created_at);
    assertDate('next_attempt_at', next_attempt_at);
    assertDate('locked_until', locked_until, { nullable: true });
    assertDate('attended_at', attended_at, { nullable: true });
    assertDate('sent_at', sent_at, { nullable: true });

    if (!Number.isInteger(dispatch_attempts) || dispatch_attempts < 0) {
      throw new InvalidDataError('dispatch_attempts debe ser un entero no negativo');
    }
    if (attention_status === AttentionStatus.ATTENDED && attended_at === null) {
      throw new InvalidDataError('attended_at es obligatorio cuando la notificación fue atendida');
    }
    if (dispatch_status === DispatchStatus.SENT && sent_at === null) {
      throw new InvalidDataError('sent_at es obligatorio cuando dispatch_status es SENT');
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
    this.attention_status = attention_status;
    this.attended_at = attended_at;
    this.dispatch_status = dispatch_status;
    this.dispatch_attempts = dispatch_attempts;
    this.next_attempt_at = next_attempt_at;
    this.locked_until = locked_until;
    this.failure_reason = failure_reason;
    this.provider_message_id = provider_message_id;
    this.created_at = created_at;
    this.sent_at = sent_at;
  }

  isFinal() {
    return (
      this.dispatch_status === DispatchStatus.SENT || this.dispatch_status === DispatchStatus.FAILED
    );
  }

  claim(now, leaseMs) {
    if (this.dispatch_status !== DispatchStatus.PENDING_DISPATCH) {
      return null;
    }
    if (this.next_attempt_at.getTime() > now.getTime()) {
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
    if (this.dispatch_status === DispatchStatus.SENT) {
      return this;
    }
    if (this.dispatch_status === DispatchStatus.FAILED) {
      throw new InvalidStateTransitionError('No se puede enviar una notificación FAILED');
    }
    if (!providerMessageId) {
      throw new InvalidDataError('provider_message_id es obligatorio para marcar SENT');
    }
    return new Notification({
      ...this,
      dispatch_status: DispatchStatus.SENT,
      sent_at: now,
      locked_until: null,
      failure_reason: null,
      provider_message_id: providerMessageId,
    });
  }

  markFailed(now, reason, attempts = this.dispatch_attempts + 1) {
    assertDate('failed_at', now);
    if (this.dispatch_status === DispatchStatus.FAILED) {
      return this;
    }
    if (this.dispatch_status === DispatchStatus.SENT) {
      throw new InvalidStateTransitionError('No se puede fallar una notificación SENT');
    }
    if (!reason) {
      throw new InvalidDataError('failure_reason es obligatorio para marcar FAILED');
    }
    return new Notification({
      ...this,
      dispatch_status: DispatchStatus.FAILED,
      dispatch_attempts: attempts,
      locked_until: null,
      failure_reason: reason,
    });
  }

  scheduleRetry(nextAttemptAt, reason, attempts = this.dispatch_attempts + 1) {
    assertDate('next_attempt_at', nextAttemptAt);
    if (this.dispatch_status !== DispatchStatus.PENDING_DISPATCH) {
      throw new InvalidStateTransitionError('Solo se reprograma una notificación pendiente');
    }
    if (!reason) {
      throw new InvalidDataError('failure_reason es obligatorio para reprogramar');
    }
    return new Notification({
      ...this,
      dispatch_attempts: attempts,
      next_attempt_at: nextAttemptAt,
      locked_until: null,
      failure_reason: reason,
    });
  }

  markAttended(at) {
    assertDate('attended_at', at);
    if (this.attention_status === AttentionStatus.ATTENDED) {
      return this;
    }
    return new Notification({
      ...this,
      attention_status: AttentionStatus.ATTENDED,
      attended_at: at,
    });
  }
}

module.exports = { Notification };
