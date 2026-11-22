const IGNORED_EVENT_TYPES = Object.freeze([
  'assignment_created_event',
  'vehicle_status_changed_event',
  'document_registered_event',
  'document_renewed_event',
  'maintenance_completed_event',
  'RutaIniciadaEvent',
  'RutaFinalizadaEvent',
  'RutaParcialCalculadaEvent',
  'driver_activated_event',
  'driver_blocked_event',
  'driver_updated_event',
  'vehicle_created_event',
  'vehicle_update_event',
  'vehicle_deleted_event',
  'vehicle_odometer_updated_event',
]);

module.exports = { IGNORED_EVENT_TYPES };
