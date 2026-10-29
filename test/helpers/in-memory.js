const {
  ACKNOWLEDGEMENT_STATUS_VALUES,
  DELIVERY_STATUS_VALUES,
  DeliveryStatus,
  SEVERITY_VALUES,
} = require('../../src/domain/enums');

const createInMemoryState = () => ({
  alerts: new Map(),
  notifications: new Map(),
  processedEvents: new Map(),
  outboxEvents: new Map(),
});

const createInMemoryRepositories = (state = createInMemoryState()) => {
  const alerts = {
    async create(alert) {
      state.alerts.set(alert.alert_id, alert);
    },
    async findById(alertId) {
      return state.alerts.get(alertId) ?? null;
    },
    async acknowledge(alertId, at) {
      const alert = state.alerts.get(alertId);
      if (!alert) {
        return null;
      }
      const updated = alert.acknowledge(at);
      state.alerts.set(alertId, updated);
      return updated;
    },
    async updateAcknowledgement(alert) {
      state.alerts.set(alert.alert_id, alert);
    },
    async countCriticalPending() {
      return [...state.alerts.values()].filter((alert) => alert.isCriticalPending()).length;
    },
  };

  const notifications = {
    async createMany(items) {
      for (const item of items) {
        state.notifications.set(item.notification_id, item);
      }
    },
    async findById(notificationId) {
      return state.notifications.get(notificationId) ?? null;
    },
    async findByAlertId(alertId) {
      return [...state.notifications.values()].filter((item) => item.alert_id === alertId);
    },
    async findDuePending(now, limit) {
      return [...state.notifications.values()]
        .filter(
          (item) =>
            item.delivery_status === DeliveryStatus.PENDING &&
            item.next_attempt_at !== null &&
            item.next_attempt_at.getTime() <= now.getTime(),
        )
        .slice(0, limit);
    },
    async claimForDispatch(notificationId, now, leaseMs) {
      const current = state.notifications.get(notificationId);
      if (!current) {
        return null;
      }
      const claimed = current.claim(now, leaseMs);
      if (!claimed) {
        return null;
      }
      state.notifications.set(notificationId, claimed);
      return claimed;
    },
    async markSent(notification) {
      state.notifications.set(notification.notification_id, notification);
    },
    async markFailed(notification) {
      state.notifications.set(notification.notification_id, notification);
    },
    async scheduleRetry(notification) {
      state.notifications.set(notification.notification_id, notification);
    },
    async releaseClaim(notificationId) {
      const current = state.notifications.get(notificationId);
      if (current) {
        state.notifications.set(notificationId, current.releaseClaim());
      }
    },
    async acknowledgeByAlertId(alertId, at) {
      for (const [id, item] of state.notifications) {
        if (item.alert_id === alertId) {
          state.notifications.set(id, item.acknowledge(at));
        }
      }
    },
    async search({ filters = {}, page = 0, size = 20 }) {
      const all = [...state.notifications.values()]
        .filter((item) => {
          if (filters.recipient_role && item.recipient_role !== filters.recipient_role) {
            return false;
          }
          if (filters.type && item.type !== filters.type) {
            return false;
          }
          if (filters.severity && item.severity !== filters.severity) {
            return false;
          }
          if (filters.delivery_status && item.delivery_status !== filters.delivery_status) {
            return false;
          }
          if (
            filters.acknowledgement_status &&
            item.acknowledgement_status !== filters.acknowledgement_status
          ) {
            return false;
          }
          if (filters.reference_id && item.reference_id !== filters.reference_id) {
            return false;
          }
          if (filters.date_from && item.created_at < filters.date_from) {
            return false;
          }
          if (filters.date_to && item.created_at > filters.date_to) {
            return false;
          }
          return true;
        })
        .sort((left, right) => right.created_at - left.created_at);
      const bySeverity = Object.fromEntries(SEVERITY_VALUES.map((value) => [value, 0]));
      const byDelivery = Object.fromEntries(DELIVERY_STATUS_VALUES.map((value) => [value, 0]));
      const byAcknowledgement = Object.fromEntries(
        ACKNOWLEDGEMENT_STATUS_VALUES.map((value) => [value, 0]),
      );
      for (const item of all) {
        bySeverity[item.severity] += 1;
        byDelivery[item.delivery_status] += 1;
        byAcknowledgement[item.acknowledgement_status] += 1;
      }
      return {
        items: all.slice(page * size, page * size + size),
        total: all.length,
        summary: {
          by_severity: bySeverity,
          by_delivery_status: byDelivery,
          by_acknowledgement_status: byAcknowledgement,
        },
      };
    },
    async countAll() {
      return state.notifications.size;
    },
    async countBySeverity() {
      const result = Object.fromEntries(SEVERITY_VALUES.map((value) => [value, 0]));
      for (const item of state.notifications.values()) {
        result[item.severity] += 1;
      }
      return result;
    },
    async countByDeliveryStatus() {
      const result = Object.fromEntries(DELIVERY_STATUS_VALUES.map((value) => [value, 0]));
      for (const item of state.notifications.values()) {
        result[item.delivery_status] += 1;
      }
      return result;
    },
  };

  const processedEvents = {
    async exists(eventId) {
      return state.processedEvents.has(eventId);
    },
    async create(record) {
      state.processedEvents.set(record.event_id, record);
    },
  };

  const outboxEvents = {
    async create(record) {
      state.outboxEvents.set(record.event_id, record);
    },
    async findById(eventId) {
      return state.outboxEvents.get(eventId) ?? null;
    },
    async findPendingDue() {
      return [];
    },
    async markPublished() {},
  };

  return { alerts, notifications, processedEvents, outboxEvents };
};

const createInMemoryUnitOfWork = (state = createInMemoryState()) => {
  const repositories = createInMemoryRepositories(state);
  return {
    state,
    repositories,
    async run(work) {
      const snapshot = {
        alerts: new Map(state.alerts),
        notifications: new Map(state.notifications),
        processedEvents: new Map(state.processedEvents),
        outboxEvents: new Map(state.outboxEvents),
      };
      try {
        return await work(repositories);
      } catch (error) {
        state.alerts = snapshot.alerts;
        state.notifications = snapshot.notifications;
        state.processedEvents = snapshot.processedEvents;
        state.outboxEvents = snapshot.outboxEvents;
        throw error;
      }
    },
  };
};

module.exports = {
  createInMemoryState,
  createInMemoryRepositories,
  createInMemoryUnitOfWork,
};
