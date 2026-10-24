const buildAssignmentInterruptedTemplate = ({ resultado }) => {
  const subject = '[FleetOps] Asignación interrumpida';
  const resultText =
    resultado === 'MANUAL_REQUERIDA'
      ? 'La asignación requiere gestión manual.'
      : resultado === 'AUTOMATICA_FALLIDA'
        ? 'La reasignación automática falló.'
        : resultado === 'AUTOMATICA_EXITOSA'
          ? 'La reasignación automática fue exitosa.'
          : 'El resultado de la reasignación está pendiente de confirmar por el productor.';
  return {
    subject,
    message: [
      'Su asignación fue interrumpida.',
      resultText,
      'Ingrese a FleetOps para revisar el estado de su vehículo.',
    ].join('\n'),
  };
};

module.exports = { buildAssignmentInterruptedTemplate };
