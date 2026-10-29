const { randomUUID } = require('node:crypto');

const buildScenarios = ({
  eventId = randomUUID(),
  correlationId = randomUUID(),
  ahora = new Date().toISOString(),
  origen = 'local-smoke',
} = {}) => {
  const baseEnvelope = {
    evento_id: eventId,
    version: 1,
    fecha_evento: ahora,
    origen,
    correlation_id: correlationId,
  };

  return {
    incident: {
      envelope: {
        ...baseEnvelope,
        tipo_evento: 'IncidenteReportadoEvent',
        datos: {
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
    assignment: {
      envelope: {
        ...baseEnvelope,
        tipo_evento: 'AsignacionInterrumpidaEvent',
        datos: {
          empleado_email: 'conductor.prueba@example.invalid',
          resultado: 'MANUAL_REQUERIDA',
          asignacion_id: `asg-${eventId}`,
        },
      },
    },
    'document-expiring': {
      envelope: {
        ...baseEnvelope,
        tipo_evento: 'DocumentoProximoAVencerEvent',
        datos: {
          dias_restantes: 30,
          documento_id: `doc-${eventId}`,
          entidad_tipo: 'VEHICULO',
        },
      },
    },
    'document-expired': {
      envelope: {
        ...baseEnvelope,
        tipo_evento: 'DocumentoVencidoEvent',
        datos: {
          documento_id: `doc-${eventId}`,
          entidad_tipo: 'VEHICULO',
        },
      },
    },
    maintenance: {
      envelope: {
        ...baseEnvelope,
        tipo_evento: 'MantenimientoPreventivoRequeridoEvent',
        datos: {
          kilometros: 150000,
          vehiculo_id: 'veh-smoke',
          mantenimiento_id: `mant-${eventId}`,
        },
      },
    },
    'invalid-envelope': {
      raw: '{"evento_id":"no-es-uuid","tipo_evento":"IncidenteReportadoEvent"}',
    },
    'invalid-data': {
      envelope: {
        ...baseEnvelope,
        tipo_evento: 'IncidenteReportadoEvent',
        datos: {
          incidente_id: `inc-${eventId}`,
        },
      },
    },
  };
};

module.exports = { buildScenarios };
