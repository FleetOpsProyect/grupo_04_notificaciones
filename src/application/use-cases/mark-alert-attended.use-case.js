const { NotificationNotFoundError } = require('../../domain/errors');
const { formatBogotaIso } = require('../shared/time');

const createMarkAlertAttendedUseCase = ({ unitOfWork, clock }) => {
  return async function markAlertAttended(notificationId) {
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
      const attendedAlert = alert.markAttended(now);
      await transaction.notifications.markAttendedByAlertId(alert.alert_id, now);
      if (attendedAlert !== alert) {
        await transaction.alerts.updateAttention(attendedAlert);
      }
      return {
        notification_id: notification.notification_id,
        alert_id: alert.alert_id,
        attention_status: attendedAlert.attention_status,
        attended_at: formatBogotaIso(attendedAlert.attended_at),
      };
    });
  };
};

module.exports = { createMarkAlertAttendedUseCase };
