const { Timestamp } = require('firebase-admin/firestore');

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

const outboxEventToDocument = (record) => ({
  event_type: record.event_type,
  data: record.data,
  notification_id: record.notification_id,
  status: record.status,
  publish_attempts: record.publish_attempts,
  next_attempt_at: toTimestamp(record.next_attempt_at),
  created_at: toTimestamp(record.created_at),
  published_at: toTimestamp(record.published_at),
  correlation_id: record.correlation_id ?? null,
});

const documentToOutboxEvent = (id, data) => ({
  event_id: id,
  event_type: data.event_type,
  data: data.data,
  notification_id: data.notification_id,
  status: data.status,
  publish_attempts: data.publish_attempts ?? 0,
  next_attempt_at: toDate(data.next_attempt_at),
  created_at: toDate(data.created_at),
  published_at: toDate(data.published_at),
  correlation_id: data.correlation_id ?? null,
});

module.exports = { outboxEventToDocument, documentToOutboxEvent, toDate, toTimestamp };
