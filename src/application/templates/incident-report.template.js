const { formatBogotaText } = require('../shared/time');

const buildIncidentReportTemplate = ({
  kind = 'SEVERE',
  requiereAsistencia,
  vehiculoId,
  incidenteId,
  asignacionId,
  conductorId,
  tipoIncidente,
  fechaReporte,
}) => {
  const prefix = requiereAsistencia ? '[URGENTE] ' : '';
  const label = kind === 'MINOR' ? 'Incidente leve reportado' : 'Incidente reportado';
  const subject = `${prefix}[FleetOps] ${label} en el vehículo ${vehiculoId}`;
  const lines = [
    `Se reportó un ${kind === 'MINOR' ? 'incidente leve' : 'incidente'} en el vehículo ${vehiculoId}.`,
    `Incidente: ${incidenteId}`,
    `Tipo: ${tipoIncidente}`,
    `Fecha del reporte: ${formatBogotaText(fechaReporte)}`,
  ];
  if (asignacionId) {
    lines.push(`Asignación: ${asignacionId}`);
  }
  if (conductorId) {
    lines.push(`Conductor: ${conductorId}`);
  }
  if (requiereAsistencia) {
    lines.push('', 'REQUIERE ASISTENCIA INMEDIATA');
  }
  return { subject, message: lines.join('\n') };
};

module.exports = { buildIncidentReportTemplate };
