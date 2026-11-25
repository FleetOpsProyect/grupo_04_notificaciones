const ownerLabel = (ownerType) => {
  if (ownerType === 'VEHICLE') {
    return 'vehículo';
  }
  if (ownerType === 'DRIVER') {
    return 'conductor';
  }
  return 'propietario';
};

const buildDocumentExpiringTemplate = ({
  daysRemaining,
  documentId,
  documentType,
  ownerType,
  ownerId,
  expirationDate,
}) => {
  const type = documentType ?? 'documento';
  const owner = ownerId ?? 'propietario';
  const expiration = expirationDate ?? 'fecha no disponible';
  const subject = `[FleetOps] Documento próximo a vencer: ${type} de ${owner}`;
  const message = `El documento ${type} (${documentId}) del ${ownerLabel(
    ownerType,
  )} ${owner} vence el ${expiration} (faltan ${daysRemaining} días).`;
  return { subject, message };
};

module.exports = { buildDocumentExpiringTemplate, ownerLabel };
