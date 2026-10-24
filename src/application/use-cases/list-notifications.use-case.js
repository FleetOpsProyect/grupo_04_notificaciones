const { SEVERITY_VALUES } = require('../../domain/enums');
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
      dispatch_status: query.dispatch_status ?? null,
      attention_status: query.attention_status ?? null,
      reference_id: query.reference_id ?? null,
      date_from: normalizeDateFilter(query.date_from, 'date_from'),
      date_to: normalizeDateFilter(query.date_to, 'date_to'),
    };
    const page = query.page ?? 0;
    const size = query.size ?? 20;
    const result = await notificationRepository.search({ filters, page, size });
    const severity = Object.fromEntries(SEVERITY_VALUES.map((value) => [value, 0]));
    for (const [key, value] of Object.entries(result.summary?.by_severity ?? {})) {
      if (Object.hasOwn(severity, key)) {
        severity[key] = value;
      }
    }
    const dispatch = {
      PENDING_DISPATCH: 0,
      SENT: 0,
      FAILED: 0,
      ...(result.summary?.by_dispatch_status ?? {}),
    };
    const contenido = result.items.map((notification) =>
      toNotificationView(
        notification,
        recipientDirectory.resolve(notification.recipient_role, notification),
      ),
    );
    return {
      contenido,
      page,
      size,
      total: result.total,
      resumen: {
        by_severity: severity,
        by_dispatch_status: dispatch,
      },
    };
  };
};

module.exports = { createListNotificationsUseCase };
