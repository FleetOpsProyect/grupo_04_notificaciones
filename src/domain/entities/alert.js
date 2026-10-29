const {
  AcknowledgementStatus,
  ACKNOWLEDGEMENT_STATUS_VALUES,
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
    acknowledgement_status = AcknowledgementStatus.PENDING,
    acknowledged_at = null,
    correlation_id,
    created_at,
  }) {
    if (!alert_id) {
      throw new InvalidDataError('alert_id es obligatorio');
    }
    assertEnum('origin', origin, ORIGIN_VALUES);
    assertEnum('type', type, TYPE_VALUES);
    assertEnum('severity', severity, SEVERITY_VALUES);
    assertEnum('acknowledgement_status', acknowledgement_status, ACKNOWLEDGEMENT_STATUS_VALUES);
    assertDate('created_at', created_at);
    if (acknowledged_at !== null) {
      assertDate('acknowledged_at', acknowledged_at);
    }
    if (
      acknowledgement_status === AcknowledgementStatus.ACKNOWLEDGED &&
      acknowledged_at === null
    ) {
      throw new InvalidDataError(
        'acknowledged_at es obligatorio cuando la alerta fue reconocida',
      );
    }

    this.alert_id = alert_id;
    this.origin = origin;
    this.source_event_type = source_event_type;
    this.event_id = event_id;
    this.type = type;
    this.severity = severity;
    this.reference_id = reference_id;
    this.acknowledgement_status = acknowledgement_status;
    this.acknowledged_at = acknowledged_at;
    this.correlation_id = correlation_id;
    this.created_at = created_at;
  }

  acknowledge(at) {
    assertDate('acknowledged_at', at);
    if (this.acknowledgement_status === AcknowledgementStatus.ACKNOWLEDGED) {
      return this;
    }
    return new Alert({
      ...this,
      acknowledgement_status: AcknowledgementStatus.ACKNOWLEDGED,
      acknowledged_at: at,
    });
  }

  isCriticalPending() {
    return (
      this.severity === 'CRITICAL' &&
      this.acknowledgement_status === AcknowledgementStatus.PENDING
    );
  }
}

module.exports = { Alert };
