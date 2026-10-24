const { processedEventToDocument } = require('./mappers/processed-event.mapper');

const createProcessedEventFirestoreRepository = (db, transaction = null) => {
  const collection = db.collection('processed_events');

  const read = (reference) => (transaction ? transaction.get(reference) : reference.get());
  const write = (reference, document) =>
    transaction ? transaction.set(reference, document) : reference.set(document);

  return {
    async exists(eventId) {
      const snapshot = await read(collection.doc(eventId));
      return snapshot.exists;
    },
    async create(record) {
      await write(collection.doc(record.evento_id), processedEventToDocument(record));
    },
  };
};

module.exports = { createProcessedEventFirestoreRepository };
