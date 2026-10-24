const { DispatchStatus, SEVERITY_VALUES } = require('../../domain/enums');
const { formatBogotaIso } = require('../shared/time');

const createGetNotificationStatusUseCase = ({ alertRepository, notificationRepository, clock }) => {
  return async function getNotificationStatus() {
    const [criticalPending, total, bySeverity, byDispatch] = await Promise.all([
      alertRepository.countCriticalPending(),
      notificationRepository.countAll(),
      notificationRepository.countBySeverity(),
      notificationRepository.countByDispatchStatus(),
    ]);

    const severity = Object.fromEntries(SEVERITY_VALUES.map((value) => [value, 0]));
    for (const [key, value] of Object.entries(bySeverity ?? {})) {
      if (Object.hasOwn(severity, key)) {
        severity[key] = value;
      }
    }

    return {
      alertas_criticas_pendientes: criticalPending,
      total_notifications: total,
      by_severity: severity,
      dispatch: {
        pending: byDispatch?.[DispatchStatus.PENDING_DISPATCH] ?? 0,
        sent: byDispatch?.[DispatchStatus.SENT] ?? 0,
        failed: byDispatch?.[DispatchStatus.FAILED] ?? 0,
      },
      generated_at: formatBogotaIso(clock.now()),
    };
  };
};

module.exports = { createGetNotificationStatusUseCase };
