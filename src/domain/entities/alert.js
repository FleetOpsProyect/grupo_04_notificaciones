const {
  AttentionStatus,
  ATTENTION_STATUS_VALUES,
  ORIGIN_VALUES,
  SEVERITY_VALUES,
  TYPE_VALUES,
} = require('../enums');
const { InvalidDataError } = require('../errors');

const assertEnum = (field, value, allowed) => {
  if (!allowed.includes(value)) {
    throw new InvalidDataError(`Valor inválido para ${field}: ${value}`);
  }
};

const assertDate = (field, value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidDataError(`Fecha inválida para ${field}`);
  }
};

class Alert {
  constructor({
    alert_id,
    origin,
    source_event_type = null,
    event_id = null,
    type,
    severity,
    reference_id = null,
    attention_status = AttentionStatus.PENDING,
    attended_at = null,
    correlation_id,
    created_at,
  }) {
    if (!alert_id) {
      throw new InvalidDataError('alert_id es obligatorio');
    }
    assertEnum('origin', origin, ORIGIN_VALUES);
    assertEnum('type', type, TYPE_VALUES);
    assertEnum('severity', severity, SEVERITY_VALUES);
    assertEnum('attention_status', attention_status, ATTENTION_STATUS_VALUES);
    assertDate('created_at', created_at);
    if (attended_at !== null) {
      assertDate('attended_at', attended_at);
    }
    if (attention_status === AttentionStatus.ATTENDED && attended_at === null) {
      throw new InvalidDataError('attended_at es obligatorio cuando la alerta fue atendida');
    }

    this.alert_id = alert_id;
    this.origin = origin;
    this.source_event_type = source_event_type;
    this.event_id = event_id;
    this.type = type;
    this.severity = severity;
    this.reference_id = reference_id;
    this.attention_status = attention_status;
    this.attended_at = attended_at;
    this.correlation_id = correlation_id;
    this.created_at = created_at;
  }

  markAttended(at) {
    assertDate('attended_at', at);
    if (this.attention_status === AttentionStatus.ATTENDED) {
      return this;
    }
    return new Alert({
      ...this,
      attention_status: AttentionStatus.ATTENDED,
      attended_at: at,
    });
  }

  isCriticalPending() {
    return this.severity === 'CRITICAL' && this.attention_status === AttentionStatus.PENDING;
  }
}

module.exports = { Alert };
