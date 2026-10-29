const { randomUUID } = require('node:crypto');

const buildScenarios = ({
  eventId = randomUUID(),
  correlationId = randomUUID(),
  ahora = new Date().toISOString(),
  source = 'local-smoke',
} = {}) => {
  const baseEnvelope = {
    event_id: eventId,
    version: 1,
    occurred_at: ahora,
    source,
    correlation_id: correlationId,
  };

  return {
    incident: {
      envelope: {
        ...baseEnvelope,
        event_type: 'severe_incident_reported_event',
        data: {
          incidente_id: `inc-${eventId}`,
          asignacion_id: `asg-${eventId}`,
          vehiculo_id: 'veh-smoke',
          conductor_id: 'con-smoke',
          tipo_incidente: 'FALLA_MECANICA',
          requiere_asistencia: true,
          fecha_reporte: ahora,
        },
      },
    },
    'minor-incident': {
      envelope: {
        ...baseEnvelope,
        event_type: 'minor_incident_reported_event',
        data: {
          incidente_id: `inc-${eventId}`,
          vehiculo_id: 'veh-smoke',
          tipo_incidente: 'FALLA_LEVE',
          requiere_asistencia: false,
          fecha_reporte: ahora,
        },
      },
    },
    assignment: {
      envelope: {
        ...baseEnvelope,
        event_type: 'interrupted_assignment_event',
        data: {
          assignment_id: `asg-${eventId}`,
          vehicle_id: 'veh-smoke',
          driver_id: 'drv-smoke',
          employee_id: 'emp-smoke',
          employee_email: 'conductor.prueba@example.invalid',
          incident_id: `inc-${eventId}`,
          reassignment_result: 'MANUAL_REQUIRED',
        },
      },
    },
    'document-expiring': {
      envelope: {
        ...baseEnvelope,
        event_type: 'document_expiring_soon_event',
        data: {
          document_id: `doc-${eventId}`,
          document_type: 'SOAT',
          owner_type: 'VEHICLE',
          owner_id: 'veh-smoke',
          expiration_date: ahora,
          threshold_days: 30,
          days_remaining: 30,
        },
      },
    },
    'document-expired': {
      envelope: {
        ...baseEnvelope,
        event_type: 'document_expired_event',
        data: {
          document_id: `doc-${eventId}`,
          document_type: 'SOAT',
          owner_type: 'VEHICLE',
          owner_id: 'veh-smoke',
          expiration_date: ahora,
        },
      },
    },
    maintenance: {
      envelope: {
        ...baseEnvelope,
        event_type: 'MantenimientoPreventivoRequeridoEvent',
        data: {
          mantenimiento_id: `mant-${eventId}`,
          vehiculo_id: 'veh-smoke',
          kilometraje_actual: 150000,
          umbral_km: 150000,
          motivo: 'Preventivo por kilometraje',
        },
      },
    },
    fuel: {
      envelope: {
        ...baseEnvelope,
        event_type: 'fuel_anomaly_detected_event',
        data: {
          fuel_record_id: `fuel-${eventId}`,
          assignment_id: `asg-${eventId}`,
          vehicle_id: 'veh-smoke',
          driver_id: 'drv-smoke',
          route_id: `ruta-${eventId}`,
          efficiency_km_per_gallon: 28.5,
          average_efficiency_km_per_gallon: 42.1,
          gallons_purchased: 10,
          total_cost: 165000,
          recorded_at: ahora,
        },
      },
    },
    'invalid-envelope': {
      raw: '{"event_id":"no-es-uuid","event_type":"severe_incident_reported_event"}',
    },
    'invalid-data': {
      envelope: {
        ...baseEnvelope,
        event_type: 'severe_incident_reported_event',
        data: {
          incidente_id: `inc-${eventId}`,
        },
      },
    },
  };
};

module.exports = { buildScenarios };
