const RESULT_TEXT = Object.freeze({
  MANUAL_REQUIRED: 'Debes crear una nueva solicitud de vehículo.',
  AUTOMATIC_FAILED:
    'No fue posible reasignarte un vehículo; debes crear una nueva solicitud de vehículo.',
  AUTOMATIC_SUCCESSFUL: 'Ya tienes un vehículo nuevo asignado.',
});

const buildAssignmentInterruptedTemplate = ({
  assignmentId,
  incidentId,
  reassignmentResult,
  newAssignmentId,
} = {}) => {
  const subject = '[FleetOps] Asignación interrumpida';
  const assignment = assignmentId ? `Tu asignación ${assignmentId}` : 'Tu asignación';
  const incident = incidentId ? ` por el incidente ${incidentId}` : '';
  const resultText =
    RESULT_TEXT[reassignmentResult] ??
    'El resultado de la reasignación está pendiente de confirmar por el productor.';
  const lines = [`${assignment} fue interrumpida${incident}.`, resultText];
  if (newAssignmentId) {
    lines.push(`Nueva asignación: ${newAssignmentId}.`);
  }
  lines.push('Ingresa a FleetOps para revisar el estado de tu vehículo.');
  return { subject, message: lines.join('\n') };
};

module.exports = { buildAssignmentInterruptedTemplate };
