const { NotificationNotFoundError } = require('../../domain/errors');
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
      const acknowledgedAlert = alert.acknowledge(now);
      await transaction.notifications.acknowledgeByAlertId(alert.alert_id, now);
      if (acknowledgedAlert !== alert) {
        await transaction.alerts.updateAcknowledgement(acknowledgedAlert);
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
