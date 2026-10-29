const buildDocumentExpiringTemplate = ({
  daysRemaining,
  documentId,
  documentType,
  ownerType,
  thresholdDays,
}) => {
  const subject =
    daysRemaining === null || daysRemaining === undefined
      ? '[FleetOps] Documento próximo a vencer'
      : `[FleetOps] Documento próximo a vencer en ${daysRemaining} días`;
  const lines = [`Un documento${documentId ? ` (${documentId})` : ''} está próximo a vencer.`];
  if (documentType) {
    lines.push(`Tipo de documento: ${documentType}.`);
  }
  if (ownerType) {
    lines.push(`Tipo de propietario: ${ownerType}.`);
  }
  if (daysRemaining !== null && daysRemaining !== undefined) {
    lines.push(`Días restantes: ${daysRemaining}.`);
  }
  if (thresholdDays !== null && thresholdDays !== undefined) {
    lines.push(`Umbral de alerta: ${thresholdDays} días.`);
  }
  lines.push('Revise la documentación en FleetOps.');
  return { subject, message: lines.join('\n') };
};

module.exports = { buildDocumentExpiringTemplate };
