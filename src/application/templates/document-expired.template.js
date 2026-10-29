const { formatBogotaText } = require('../shared/time');

const buildDocumentExpiredTemplate = ({
  documentId,
  documentType,
  ownerType,
  expirationDate,
}) => {
  const subject = '[FleetOps] Documento vencido';
  const lines = [`Se detectó un documento vencido${documentId ? ` (${documentId})` : ''}.`];
  if (documentType) {
    lines.push(`Tipo de documento: ${documentType}.`);
  }
  if (ownerType) {
    lines.push(`Tipo de propietario: ${ownerType}.`);
  }
  if (expirationDate) {
    lines.push(`Fecha de vencimiento: ${formatBogotaText(expirationDate)}.`);
  }
  lines.push('Regularice la documentación en FleetOps.');
  return { subject, message: lines.join('\n') };
};

module.exports = { buildDocumentExpiredTemplate };
