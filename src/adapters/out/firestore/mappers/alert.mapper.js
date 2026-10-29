const { Timestamp } = require('firebase-admin/firestore');
const { Alert } = require('../../../../domain/entities/alert');

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

const alertToDocument = (alert) => ({
  origin: alert.origin,
  source_event_type: alert.source_event_type,
  event_id: alert.event_id,
  type: alert.type,
  severity: alert.severity,
  reference_id: alert.reference_id,
  acknowledgement_status: alert.acknowledgement_status,
  acknowledged_at: toTimestamp(alert.acknowledged_at),
  correlation_id: alert.correlation_id,
  created_at: toTimestamp(alert.created_at),
});

const documentToAlert = (id, data) =>
  new Alert({
    alert_id: id,
    origin: data.origin,
    source_event_type: data.source_event_type ?? null,
    event_id: data.event_id ?? null,
    type: data.type,
    severity: data.severity,
    reference_id: data.reference_id ?? null,
    acknowledgement_status: data.acknowledgement_status,
    acknowledged_at: toDate(data.acknowledged_at),
    correlation_id: data.correlation_id,
    created_at: toDate(data.created_at),
  });

module.exports = { alertToDocument, documentToAlert, toDate, toTimestamp };
