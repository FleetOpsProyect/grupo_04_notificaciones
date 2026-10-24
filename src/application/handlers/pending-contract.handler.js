const PENDING_EVENT_TYPES = Object.freeze([
  'IncidenteLeveRegistradoEvent',
  'IncidenteGraveReportadoEvent',
  'AsignacionCreadaEvent',
  'AsignacionModificadaEvent',
  'ConsumoAnomaloDetectadoEvent',
]);

const buildPlan = () => null;

module.exports = { PENDING_EVENT_TYPES, buildPlan };
