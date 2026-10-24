const { InvalidDataError } = require('../../domain/errors');

const createNotificationPlan = ({ alert, notifications }) => {
  if (!alert || typeof alert !== 'object') {
    throw new InvalidDataError('El plan requiere una alerta');
  }
  if (!Array.isArray(notifications) || notifications.length === 0) {
    throw new InvalidDataError('El plan requiere al menos una notificación');
  }
  return { alert, notifications };
};

module.exports = { createNotificationPlan };
