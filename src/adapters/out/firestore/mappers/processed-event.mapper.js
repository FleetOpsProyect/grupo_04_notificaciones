const { Timestamp } = require('firebase-admin/firestore');

const processedEventToDocument = (record) => ({
  event_type: record.event_type,
  source: record.source,
  message_id: record.message_id ?? null,
  queue_url: record.queue_url ?? null,
  occurred_at: Timestamp.fromDate(record.occurred_at),
  processed_at: Timestamp.fromDate(record.processed_at),
  expires_at: Timestamp.fromDate(record.expires_at),
});

module.exports = { processedEventToDocument };
