const { Timestamp } = require('firebase-admin/firestore');

const processedEventToDocument = (record) => ({
  event_type: record.event_type,
  source: record.source,
  topic: record.topic,
  partition: record.partition,
  offset: record.offset,
  occurred_at: Timestamp.fromDate(record.occurred_at),
  processed_at: Timestamp.fromDate(record.processed_at),
});

module.exports = { processedEventToDocument };
