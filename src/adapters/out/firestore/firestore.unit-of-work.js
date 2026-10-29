const { DomainError, ServiceUnavailableError } = require('../../../domain/errors');
const { createAlertFirestoreRepository } = require('./alert.firestore.repository');
const { createNotificationFirestoreRepository } = require('./notification.firestore.repository');
const {
  createProcessedEventFirestoreRepository,
} = require('./processed-event.firestore.repository');
const { createOutboxEventFirestoreRepository } = require('./outbox-event.firestore.repository');

const createFirestoreUnitOfWork = (db) => ({
  async run(work) {
    try {
      return await db.runTransaction(async (transaction) => {
        const transactionRepositories = {
          alerts: createAlertFirestoreRepository(db, transaction),
          notifications: createNotificationFirestoreRepository(db, transaction),
          processedEvents: createProcessedEventFirestoreRepository(db, transaction),
          outboxEvents: createOutboxEventFirestoreRepository(db, transaction),
        };
        return work(transactionRepositories);
      });
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new ServiceUnavailableError('Firestore no está disponible');
    }
  },
});

module.exports = { createFirestoreUnitOfWork };
