const buildDocumentExpiredTemplate = ({ documentoId, entidadTipo }) => {
  const subject = '[FleetOps] Documento vencido';
  const lines = [`Se detectó un documento vencido${documentoId ? ` (${documentoId})` : ''}.`];
  if (entidadTipo) {
    lines.push(`Entidad asociada: ${entidadTipo}.`);
  }
  lines.push('Regularice la documentación en FleetOps.');
  return { subject, message: lines.join('\n') };
};

module.exports = { buildDocumentExpiredTemplate };
