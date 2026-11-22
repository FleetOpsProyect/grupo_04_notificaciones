const { ownerLabel } = require('./document-expiring.template');

const buildDocumentExpiredTemplate = ({
  documentId,
  documentType,
  ownerType,
  ownerId,
  expirationDate,
}) => {
  const type = documentType ?? 'documento';
  const owner = ownerId ?? 'propietario';
  const expiration = expirationDate ?? 'fecha no disponible';
  const subject = `[FleetOps] Documento VENCIDO: ${type} de ${owner}`;
  const message = `El documento ${type} (${documentId}) del ${ownerLabel(
    ownerType,
  )} ${owner} venció el ${expiration}. Registra su renovación para reactivarlo.`;
  return { subject, message };
};

module.exports = { buildDocumentExpiredTemplate };
