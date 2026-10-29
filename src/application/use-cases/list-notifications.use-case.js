const {
  ACKNOWLEDGEMENT_STATUS_VALUES,
  DELIVERY_STATUS_VALUES,
  SEVERITY_VALUES,
} = require('../../domain/enums');
const { InvalidDataError } = require('../../domain/errors');
const { parseIsoDate } = require('../shared/time');
const { toNotificationView } = require('../shared/notification-view');

const normalizeDateFilter = (value, field) => {
  if (value === undefined || value === null) {
    return null;
  }
  const date = parseIsoDate(value);
  if (date === null) {
    throw new InvalidDataError(`${field} no es una fecha válida`);
  }
  return date;
};

const createListNotificationsUseCase = ({ notificationRepository, recipientDirectory }) => {
  return async function listNotifications(query) {
    const filters = {
      recipient_role: query.recipient_role ?? null,
      type: query.type ?? null,
      severity: query.severity ?? null,
      delivery_status: query.delivery_status ?? null,
      acknowledgement_status: query.acknowledgement_status ?? null,
      reference_id: query.reference_id ?? null,
      date_from: normalizeDateFilter(query.date_from, 'date_from'),
      date_to: normalizeDateFilter(query.date_to, 'date_to'),
    };
    const page = query.page ?? 0;
    const size = query.size ?? 20;
    const result = await notificationRepository.search({ filters, page, size });
    const bySeverity = Object.fromEntries(SEVERITY_VALUES.map((value) => [value, 0]));
    for (const [key, value] of Object.entries(result.summary?.by_severity ?? {})) {
      if (Object.hasOwn(bySeverity, key)) {
        bySeverity[key] = value;
      }
    }
    const byDelivery = Object.fromEntries(DELIVERY_STATUS_VALUES.map((value) => [value, 0]));
    for (const [key, value] of Object.entries(result.summary?.by_delivery_status ?? {})) {
      if (Object.hasOwn(byDelivery, key)) {
        byDelivery[key] = value;
      }
    }
    const byAcknowledgement = Object.fromEntries(
      ACKNOWLEDGEMENT_STATUS_VALUES.map((value) => [value, 0]),
    );
    for (const [key, value] of Object.entries(result.summary?.by_acknowledgement_status ?? {})) {
      if (Object.hasOwn(byAcknowledgement, key)) {
        byAcknowledgement[key] = value;
      }
    }
    const content = result.items.map((notification) =>
      toNotificationView(
        notification,
        recipientDirectory.resolve(notification.recipient_role, notification),
      ),
    );
    return {
      content,
      page,
      size,
      total: result.total,
      summary: {
        by_severity: bySeverity,
        by_delivery_status: byDelivery,
        by_acknowledgement_status: byAcknowledgement,
      },
    };
  };
};

module.exports = { createListNotificationsUseCase };
