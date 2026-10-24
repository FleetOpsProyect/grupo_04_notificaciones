const { DomainError, ServiceUnavailableError } = require('../../../domain/errors');
const { alertToDocument, documentToAlert, toTimestamp } = require('./mappers/alert.mapper');

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

const createAlertFirestoreRepository = (db, transaction = null) => {
  const collection = db.collection('alerts');
  const read = (reference) => (transaction ? transaction.get(reference) : reference.get());
  const write = (reference, document) =>
    transaction ? transaction.set(reference, document) : reference.set(document);
  const update = (reference, fields) =>
    transaction ? transaction.update(reference, fields) : reference.update(fields);

  const repository = {
    async create(alert) {
      const reference = collection.doc(alert.alert_id);
      await write(reference, alertToDocument(alert));
    },

    async findById(alertId) {
      const snapshot = await read(collection.doc(alertId));
      if (!snapshot.exists) {
        return null;
      }
      return documentToAlert(snapshot.id, snapshot.data());
    },

    async markAttended(alertId, at) {
      const alert = await repository.findById(alertId);
      if (alert === null) {
        return null;
      }
      const updated = alert.markAttended(at);
      if (updated !== alert) {
        await repository.updateAttention(updated);
      }
      return updated;
    },

    async updateAttention(alert) {
      await update(collection.doc(alert.alert_id), {
        attention_status: alert.attention_status,
        attended_at: toTimestamp(alert.attended_at),
      });
    },

    async countCriticalPending() {
      return guard(async () => {
        const snapshot = await collection
          .where('severity', '==', 'CRITICAL')
          .where('attention_status', '==', 'PENDING')
          .count()
          .get();
        return snapshot.data().count;
      });
    },
  };

  return repository;
};

module.exports = { createAlertFirestoreRepository };
