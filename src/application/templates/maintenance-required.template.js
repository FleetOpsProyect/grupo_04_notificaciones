const formatKilometers = (value) => {
  if (!Number.isFinite(value)) {
    return null;
  }
  return new Intl.NumberFormat('es-CO').format(Math.round(value));
};

const buildMaintenanceRequiredTemplate = ({
  kilometrajeActual,
  umbralKm,
  motivo,
  vehiculoId,
  mantenimientoId,
}) => {
  const subject = `[FleetOps] Mantenimiento preventivo requerido${
    vehiculoId ? ` para ${vehiculoId}` : ''
  }`;
  const lines = ['Se requiere un mantenimiento preventivo.'];
  if (mantenimientoId) {
    lines.push(`Mantenimiento: ${mantenimientoId}`);
  }
  if (vehiculoId) {
    lines.push(`Vehículo: ${vehiculoId}`);
  }
  const formattedKilometers = formatKilometers(kilometrajeActual);
  if (formattedKilometers !== null) {
    lines.push(`Kilometraje actual: ${formattedKilometers} km`);
  }
  const formattedThreshold = formatKilometers(umbralKm);
  if (formattedThreshold !== null) {
    lines.push(`Umbral configurado: ${formattedThreshold} km`);
  }
  if (motivo) {
    lines.push(`Motivo: ${motivo}`);
  }
  lines.push('Programe el mantenimiento en FleetOps.');
  return { subject, message: lines.join('\n') };
};

module.exports = { buildMaintenanceRequiredTemplate, formatKilometers };
