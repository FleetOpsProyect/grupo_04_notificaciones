const RESULT_TEXT = Object.freeze({
  MANUAL_REQUIRED: 'La asignación requiere gestión manual: debe crear una nueva solicitud.',
  AUTOMATIC_FAILED: 'La reasignación automática falló: debe crear una nueva solicitud.',
  AUTOMATIC_SUCCESSFUL: 'Ya tiene un vehículo asignado automáticamente.',
});

const buildAssignmentInterruptedTemplate = ({ reassignmentResult, newAssignmentId } = {}) => {
  const subject = '[FleetOps] Asignación interrumpida';
  const resultText =
    RESULT_TEXT[reassignmentResult] ??
    'El resultado de la reasignación está pendiente de confirmar por el productor.';
  const lines = ['Su asignación fue interrumpida.', resultText];
  if (newAssignmentId) {
    lines.push(`Nueva asignación: ${newAssignmentId}`);
  }
  lines.push('Ingrese a FleetOps para revisar el estado de su vehículo.');
  return { subject, message: lines.join('\n') };
};

module.exports = { buildAssignmentInterruptedTemplate };
