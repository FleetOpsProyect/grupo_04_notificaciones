const { DeliveryStatus, SEVERITY_VALUES } = require('../../domain/enums');
const { formatBogotaIso } = require('../shared/time');

const createGetNotificationStatusUseCase = ({ alertRepository, notificationRepository, clock }) => {
  return async function getNotificationStatus() {
    const [criticalPending, total, bySeverity, byDelivery] = await Promise.all([
      alertRepository.countCriticalPending(),
      notificationRepository.countAll(),
      notificationRepository.countBySeverity(),
      notificationRepository.countByDeliveryStatus(),
    ]);

    const severity = Object.fromEntries(SEVERITY_VALUES.map((value) => [value, 0]));
    for (const [key, value] of Object.entries(bySeverity ?? {})) {
      if (Object.hasOwn(severity, key)) {
        severity[key] = value;
      }
    }

    return {
      critical_alerts_pending: criticalPending,
      total_notifications: total,
      by_severity: severity,
      deliveries: {
        pending: byDelivery?.[DeliveryStatus.PENDING] ?? 0,
        sent: byDelivery?.[DeliveryStatus.SENT] ?? 0,
        failed: byDelivery?.[DeliveryStatus.FAILED] ?? 0,
      },
      generated_at: formatBogotaIso(clock.now()),
    };
  };
};

module.exports = { createGetNotificationStatusUseCase };
