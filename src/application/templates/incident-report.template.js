const { formatBogotaText } = require('../shared/time');

const buildIncidentReportTemplate = ({
  kind = 'SEVERE',
  vehicleId,
  incidentId,
  assignmentId,
  driverId,
  description,
  reportedAt,
}) => {
  const isMinor = kind === 'MINOR';
  const label = isMinor ? 'Incidente leve' : 'Incidente grave';
  const prefix = isMinor ? '' : '[URGENTE] ';
  const subject = `${prefix}[FleetOps] ${label} en el vehículo ${vehicleId}`;
  const descriptionLine = /[.!?]$/.test(description) ? description : `${description}.`;
  const lines = [
    `Incidente ${isMinor ? 'leve' : 'grave'} ${incidentId} reportado en el vehículo ${vehicleId} (asignación ${assignmentId}, conductor ${driverId}).`,
    descriptionLine,
    `Fecha: ${formatBogotaText(reportedAt)}.`,
  ];
  if (!isMinor) {
    lines.push('Atender de inmediato.');
  }
  return { subject, message: lines.join('\n') };
};

module.exports = { buildIncidentReportTemplate };
