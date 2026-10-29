const formatDecimal = (value) => {
  if (!Number.isFinite(value)) {
    return null;
  }
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const buildFuelAnomalyTemplate = ({
  fuelRecordId,
  vehicleId,
  efficiency,
  averageEfficiency,
  gallonsPurchased,
}) => {
  const subject = `[FleetOps] Consumo anómalo detectado${vehicleId ? ` en ${vehicleId}` : ''}`;
  const lines = ['Se detectó un consumo de combustible anómalo.'];
  if (fuelRecordId) {
    lines.push(`Registro de combustible: ${fuelRecordId}`);
  }
  if (vehicleId) {
    lines.push(`Vehículo: ${vehicleId}`);
  }
  const efficiencyText = formatDecimal(efficiency);
  if (efficiencyText !== null) {
    lines.push(`Rendimiento obtenido: ${efficiencyText} km/galón`);
  }
  const averageText = formatDecimal(averageEfficiency);
  if (averageText !== null) {
    lines.push(`Promedio del vehículo: ${averageText} km/galón`);
  }
  const gallonsText = formatDecimal(gallonsPurchased);
  if (gallonsText !== null) {
    lines.push(`Galones comprados: ${gallonsText}`);
  }
  lines.push('Revise el registro en FleetOps.');
  return { subject, message: lines.join('\n') };
};

module.exports = { buildFuelAnomalyTemplate };
