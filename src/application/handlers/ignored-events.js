const IGNORED_EVENT_TYPES = Object.freeze([
  'assignment_created_event',
  'modified_assignment_event',
  'document_registered_event',
  'document_renewed_event',
  'MantenimientoFinalizadoEvent',
  'RutaIniciadaEvent',
  'RutaFinalizadaEvent',
  'RutaParcialCalculadaEvent',
]);

module.exports = { IGNORED_EVENT_TYPES };
