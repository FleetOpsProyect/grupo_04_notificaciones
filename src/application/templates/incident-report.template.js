const { formatBogotaText } = require('../shared/time');

const buildIncidentReportTemplate = ({
  requiereAsistencia,
  vehiculoId,
  incidenteId,
  asignacionId,
  conductorId,
  tipoIncidente,
  fechaReporte,
}) => {
  const prefix = requiereAsistencia ? '[URGENTE] ' : '';
  const subject = `${prefix}[FleetOps] Incidente reportado en el vehículo ${vehiculoId}`;
  const lines = [
    `Se reportó un incidente en el vehículo ${vehiculoId}.`,
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
