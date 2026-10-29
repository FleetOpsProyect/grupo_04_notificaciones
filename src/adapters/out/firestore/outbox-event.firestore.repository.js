const { Timestamp } = require('firebase-admin/firestore');
const { DomainError, ServiceUnavailableError } = require('../../../domain/errors');
const {
  outboxEventToDocument,
  documentToOutboxEvent,
  toTimestamp,
} = require('./mappers/outbox-event.mapper');

const guard = async (operation) => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    throw new ServiceUnavailableError('Firestore no está disponible');
  }
};

const createOutboxEventFirestoreRepository = (db, transaction = null) => {
  const collection = db.collection('outbox_events');
  const write = (reference, document) =>
    transaction ? transaction.set(reference, document) : reference.set(document);
  const update = (reference, fields) =>
    transaction ? transaction.update(reference, fields) : reference.update(fields);

  return {
    async create(record) {
      await write(collection.doc(record.event_id), outboxEventToDocument(record));
    },

    async findById(eventId) {
      const reference = collection.doc(eventId);
      const snapshot = transaction ? await transaction.get(reference) : await reference.get();
      if (!snapshot.exists) {
        return null;
      }
      return documentToOutboxEvent(snapshot.id, snapshot.data());
    },

    async claimBatch(now, limit, leaseMs) {
      return guard(async () => {
        const claim = async (firestoreTransaction) => {
          const snapshot = await firestoreTransaction.get(
            collection
              .where('status', '==', 'PENDING')
              .where('next_attempt_at', '<=', Timestamp.fromDate(now))
              .orderBy('next_attempt_at', 'asc')
              .limit(limit),
          );
          const claimed = [];
          for (const document of snapshot.docs) {
            const record = documentToOutboxEvent(document.id, document.data());
            const attempts = record.publish_attempts + 1;
            const nextAttemptAt = new Date(now.getTime() + leaseMs);
            firestoreTransaction.update(document.ref, {
              publish_attempts: attempts,
              next_attempt_at: Timestamp.fromDate(nextAttemptAt),
            });
            claimed.push({ ...record, publish_attempts: attempts, next_attempt_at: nextAttemptAt });
          }
          return claimed;
        };

        if (transaction) {
          return claim(transaction);
        }
        return db.runTransaction(claim);
      });
    },

    async markPublished(eventId, publishedAt) {
      await guard(() =>
        update(collection.doc(eventId), {
          status: 'PUBLISHED',
          published_at: toTimestamp(publishedAt),
          next_attempt_at: null,
        }),
      );
    },

    async markFailed(eventId, nextAttemptAt) {
      await guard(() =>
        update(collection.doc(eventId), {
          next_attempt_at: toTimestamp(nextAttemptAt),
        }),
      );
    },
  };
};

module.exports = { createOutboxEventFirestoreRepository };
