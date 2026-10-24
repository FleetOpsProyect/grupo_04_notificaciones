const { Timestamp } = require('firebase-admin/firestore');
const { DomainError, ServiceUnavailableError } = require('../../../domain/errors');
const {
  notificationToDocument,
  documentToNotification,
  toTimestamp,
} = require('./mappers/notification.mapper');

const SEVERITIES = ['CRITICAL', 'WARNING', 'INFORMATIONAL'];
const DISPATCH_STATUSES = ['PENDING_DISPATCH', 'SENT', 'FAILED'];
const MAX_FALLBACK_DOCUMENTS = 10000;

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

const applyFilters = (query, filters) => {
  let filtered = query;
  if (filters.severity) {
    filtered = filtered.where('severity', '==', filters.severity);
  }
  if (filters.type) {
    filtered = filtered.where('type', '==', filters.type);
  }
  if (filters.dispatch_status) {
    filtered = filtered.where('dispatch_status', '==', filters.dispatch_status);
  }
  if (filters.attention_status) {
    filtered = filtered.where('attention_status', '==', filters.attention_status);
  }
  if (filters.reference_id) {
    filtered = filtered.where('reference_id', '==', filters.reference_id);
  }
  if (filters.alert_id) {
    filtered = filtered.where('alert_id', '==', filters.alert_id);
  }
  if (filters.recipient_role) {
    filtered = filtered.where('recipient_role', '==', filters.recipient_role);
  }
  if (filters.date_from) {
    filtered = filtered.where('created_at', '>=', Timestamp.fromDate(filters.date_from));
  }
  if (filters.date_to) {
    filtered = filtered.where('created_at', '<=', Timestamp.fromDate(filters.date_to));
  }
  return filtered;
};

const matchesInMemory = (notification, filters) => {
  if (filters.severity && notification.severity !== filters.severity) {
    return false;
  }
  if (filters.type && notification.type !== filters.type) {
    return false;
  }
  if (filters.dispatch_status && notification.dispatch_status !== filters.dispatch_status) {
    return false;
  }
  if (filters.attention_status && notification.attention_status !== filters.attention_status) {
    return false;
  }
  if (filters.reference_id && notification.reference_id !== filters.reference_id) {
    return false;
  }
  if (filters.alert_id && notification.alert_id !== filters.alert_id) {
    return false;
  }
  if (filters.recipient_role && notification.recipient_role !== filters.recipient_role) {
    return false;
  }
  if (filters.date_from && notification.created_at < filters.date_from) {
    return false;
  }
  if (filters.date_to && notification.created_at > filters.date_to) {
    return false;
  }
  return true;
};

const emptySummary = () => ({
  by_severity: { CRITICAL: 0, WARNING: 0, INFORMATIONAL: 0 },
  by_dispatch_status: { PENDING_DISPATCH: 0, SENT: 0, FAILED: 0 },
});

const createNotificationFirestoreRepository = (db, transaction = null) => {
  const collection = db.collection('notifications');
  const read = (reference) => (transaction ? transaction.get(reference) : reference.get());
  const write = (reference, document) =>
    transaction ? transaction.set(reference, document) : reference.set(document);
  const update = (reference, fields) =>
    transaction ? transaction.update(reference, fields) : reference.update(fields);

  const repository = {
    async createMany(notifications) {
      for (const notification of notifications) {
        await write(
          collection.doc(notification.notification_id),
          notificationToDocument(notification),
        );
      }
    },

    async findById(notificationId) {
      const snapshot = await read(collection.doc(notificationId));
      if (!snapshot.exists) {
        return null;
      }
      return documentToNotification(snapshot.id, snapshot.data());
    },

    async findByAlertId(alertId) {
      const snapshot = await (transaction
        ? transaction.get(collection.where('alert_id', '==', alertId))
        : collection.where('alert_id', '==', alertId).get());
      return snapshot.docs.map((document) => documentToNotification(document.id, document.data()));
    },

    async findDuePending(now, limit) {
      return guard(async () => {
        const snapshot = await collection
          .where('dispatch_status', '==', 'PENDING_DISPATCH')
          .where('next_attempt_at', '<=', Timestamp.fromDate(now))
          .orderBy('next_attempt_at', 'asc')
          .limit(limit)
          .get();
        return snapshot.docs.map((document) =>
          documentToNotification(document.id, document.data()),
        );
      });
    },

    async claimForDispatch(notificationId, now, leaseMs) {
      return guard(() =>
        db.runTransaction(async (firestoreTransaction) => {
          const reference = collection.doc(notificationId);
          const snapshot = await firestoreTransaction.get(reference);
          if (!snapshot.exists) {
            return null;
          }
          const notification = documentToNotification(snapshot.id, snapshot.data());
          const claimed = notification.claim(now, leaseMs);
          if (claimed === null) {
            return null;
          }
          firestoreTransaction.update(reference, {
            locked_until: toTimestamp(claimed.locked_until),
          });
          return claimed;
        }),
      );
    },

    async markSent(notification) {
      await guard(() =>
        update(collection.doc(notification.notification_id), {
          dispatch_status: notification.dispatch_status,
          dispatch_attempts: notification.dispatch_attempts,
          sent_at: toTimestamp(notification.sent_at),
          next_attempt_at: null,
          locked_until: null,
          failure_reason: null,
          provider_message_id: notification.provider_message_id,
        }),
      );
    },

    async markFailed(notification) {
      await guard(() =>
        update(collection.doc(notification.notification_id), {
          dispatch_status: notification.dispatch_status,
          dispatch_attempts: notification.dispatch_attempts,
          next_attempt_at: null,
          locked_until: null,
          failure_reason: notification.failure_reason,
        }),
      );
    },

    async scheduleRetry(notification) {
      await guard(() =>
        update(collection.doc(notification.notification_id), {
          dispatch_status: notification.dispatch_status,
          dispatch_attempts: notification.dispatch_attempts,
          next_attempt_at: toTimestamp(notification.next_attempt_at),
          locked_until: null,
          failure_reason: notification.failure_reason,
        }),
      );
    },

    async releaseClaim(notificationId) {
      await guard(() => update(collection.doc(notificationId), { locked_until: null }));
    },

    async markAttendedByAlertId(alertId, at) {
      if (transaction) {
        const snapshot = await transaction.get(
          collection.where('alert_id', '==', alertId).where('attention_status', '==', 'PENDING'),
        );
        for (const document of snapshot.docs) {
          const notification = documentToNotification(document.id, document.data());
          const updated = notification.markAttended(at);
          if (updated !== notification) {
            transaction.update(document.ref, {
              attention_status: updated.attention_status,
              attended_at: toTimestamp(updated.attended_at),
            });
          }
        }
        return;
      }

      await guard(() =>
        db.runTransaction(async (firestoreTransaction) => {
          const transactionRepository = createNotificationFirestoreRepository(
            db,
            firestoreTransaction,
          );
          await transactionRepository.markAttendedByAlertId(alertId, at);
        }),
      );
    },

    async search({ filters = {}, page = 0, size = 20 }) {
      const offset = page * size;
      try {
        return await guard(async () => {
          const base = applyFilters(collection, filters);
          const totalSnapshot = await base.count().get();
          const pageSnapshot = await base
            .orderBy('created_at', 'desc')
            .offset(offset)
            .limit(size)
            .get();
          const summary = emptySummary();
          for (const severity of SEVERITIES) {
            const snapshot = await base.where('severity', '==', severity).count().get();
            summary.by_severity[severity] = snapshot.data().count;
          }
          for (const dispatchStatus of DISPATCH_STATUSES) {
            const snapshot = await base
              .where('dispatch_status', '==', dispatchStatus)
              .count()
              .get();
            summary.by_dispatch_status[dispatchStatus] = snapshot.data().count;
          }
          return {
            items: pageSnapshot.docs.map((document) =>
              documentToNotification(document.id, document.data()),
            ),
            total: totalSnapshot.data().count,
            summary,
          };
        });
      } catch {
        return guard(async () => {
          const snapshot = await collection
            .orderBy('created_at', 'desc')
            .limit(MAX_FALLBACK_DOCUMENTS)
            .get();
          const all = snapshot.docs
            .map((document) => documentToNotification(document.id, document.data()))
            .filter((notification) => matchesInMemory(notification, filters));
          const summary = emptySummary();
          for (const notification of all) {
            summary.by_severity[notification.severity] += 1;
            summary.by_dispatch_status[notification.dispatch_status] += 1;
          }
          return {
            items: all.slice(offset, offset + size),
            total: all.length,
            summary,
          };
        });
      }
    },

    async countAll() {
      return guard(async () => {
        const snapshot = await collection.count().get();
        return snapshot.data().count;
      });
    },

    async countBySeverity() {
      return guard(async () => {
        const result = {};
        for (const severity of SEVERITIES) {
          const snapshot = await collection.where('severity', '==', severity).count().get();
          result[severity] = snapshot.data().count;
        }
        return result;
      });
    },

    async countByDispatchStatus() {
      return guard(async () => {
        const result = {};
        for (const dispatchStatus of DISPATCH_STATUSES) {
          const snapshot = await collection
            .where('dispatch_status', '==', dispatchStatus)
            .count()
            .get();
          result[dispatchStatus] = snapshot.data().count;
        }
        return result;
      });
    },
  };

  return repository;
};

module.exports = { createNotificationFirestoreRepository, applyFilters, matchesInMemory };
