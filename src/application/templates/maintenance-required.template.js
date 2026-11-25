const formatKilometers = (value) => {
  if (!Number.isFinite(value)) {
    return null;
  }
  return new Intl.NumberFormat('es-CO').format(Math.round(value));
};

const buildMaintenanceRequiredTemplate = ({
  currentMileage,
  thresholdKm,
  triggerReason,
  vehicleId,
  maintenanceOrderId,
}) => {
  const subject = `[FleetOps] Mantenimiento preventivo requerido: ${vehicleId}`;
  const lines = [
    `Mantenimiento preventivo requerido para el vehículo ${vehicleId}.`,
    `Kilometraje actual: ${formatKilometers(currentMileage)} km (umbral: ${formatKilometers(thresholdKm)} km).`,
    `Motivo: ${triggerReason}.`,
    `Orden: ${maintenanceOrderId}.`,
  ];
  return { subject, message: lines.join('\n') };
};

module.exports = { buildMaintenanceRequiredTemplate, formatKilometers };
