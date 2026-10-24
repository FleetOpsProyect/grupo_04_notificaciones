const { formatBogotaText } = require('../shared/time');

const buildManualNotificationTemplate = ({ type, severity, message, referenceId, createdAt }) => {
  const lines = [message.trim(), '', `Tipo: ${type}`, `Severidad: ${severity}`];
  if (referenceId) {
    lines.push(`Referencia: ${referenceId}`);
  }
  lines.push(`Fecha: ${formatBogotaText(createdAt)}`);
  return {
    subject: `[FleetOps] ${type} - ${severity}`,
    message: lines.join('\n'),
  };
};

module.exports = { buildManualNotificationTemplate };
