const { NotificationNotFoundError } = require('../../domain/errors');
const { toNotificationView } = require('../shared/notification-view');

const createGetNotificationUseCase = ({ notificationRepository, recipientDirectory }) => {
  return async function getNotification(notificationId) {
    const notification = await notificationRepository.findById(notificationId);
    if (notification === null) {
      throw new NotificationNotFoundError(notificationId);
    }
    return toNotificationView(
      notification,
      recipientDirectory.resolve(notification.recipient_role, notification),
    );
  };
};

module.exports = { createGetNotificationUseCase };
