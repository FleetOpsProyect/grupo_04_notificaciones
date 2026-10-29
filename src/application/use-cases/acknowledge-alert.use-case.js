const { NotificationNotFoundError } = require('../../domain/errors');
const { AcknowledgementStatus } = require('../../domain/enums');
const { buildAcknowledgedEvent } = require('../shared/notification-events');
const { formatBogotaIso } = require('../shared/time');

const createAcknowledgeAlertUseCase = ({ unitOfWork, clock }) => {
  return async function acknowledgeAlert(notificationId) {
    const now = clock.now();
    return unitOfWork.run(async (transaction) => {
      const notification = await transaction.notifications.findById(notificationId);
      if (notification === null) {
        throw new NotificationNotFoundError(notificationId);
      }
      const alert = await transaction.alerts.findById(notification.alert_id);
      if (alert === null) {
        throw new NotificationNotFoundError(notificationId);
      }
      const alertNotifications = await transaction.notifications.findByAlertId(alert.alert_id);
      const pendingNotifications = alertNotifications.filter(
        (item) => item.acknowledgement_status === AcknowledgementStatus.PENDING,
      );

      const acknowledgedAlert = alert.acknowledge(now);
      await transaction.notifications.acknowledgeByAlertId(alert.alert_id, now);
      if (acknowledgedAlert !== alert) {
        await transaction.alerts.updateAcknowledgement(acknowledgedAlert);
        for (const item of pendingNotifications) {
          await transaction.outboxEvents.create(
            buildAcknowledgedEvent(item, {
              acknowledgedAt: now,
              createdAt: now,
            }),
          );
        }
      }

      return {
        notification_id: notification.notification_id,
        alert_id: alert.alert_id,
        acknowledgement_status: acknowledgedAlert.acknowledgement_status,
        acknowledged_at: formatBogotaIso(acknowledgedAlert.acknowledged_at),
      };
    });
  };
};

module.exports = { createAcknowledgeAlertUseCase };
