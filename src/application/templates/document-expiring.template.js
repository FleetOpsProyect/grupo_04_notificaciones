const buildDocumentExpiringTemplate = ({ diasRestantes, documentoId, entidadTipo }) => {
  const subject = `[FleetOps] Documento próximo a vencer en ${diasRestantes} días`;
  const lines = [
    `Un documento${documentoId ? ` (${documentoId})` : ''} está próximo a vencer.`,
    `Días restantes: ${diasRestantes}.`,
  ];
  if (entidadTipo) {
    lines.push(`Entidad asociada: ${entidadTipo}.`);
  }
  lines.push('Revise la documentación en FleetOps.');
  return { subject, message: lines.join('\n') };
};

module.exports = { buildDocumentExpiringTemplate };
