const { z } = require('zod');
const { Type, Severity, RecipientRole } = require('../../domain/enums');
const { createNotificationPlan } = require('../shared/notification-plan');
const { buildIncidentReportTemplate } = require('../templates/incident-report.template');
const { parseEventData } = require('./event-data');

const eventType = 'IncidenteReportadoEvent';
const incidentDataSchema = z
  .object({
    incidente_id: z.string().min(1),
    asignacion_id: z.string().min(1).optional(),
    vehiculo_id: z.string().min(1),
    conductor_id: z.string().min(1).optional(),
    tipo_incidente: z.string().min(1),
    requiere_asistencia: z.boolean(),
    fecha_reporte: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'fecha_reporte debe ser ISO 8601',
    }),
  })
  .passthrough();

const buildPlan = (envelope) => {
  const data = parseEventData(incidentDataSchema, envelope.datos, eventType);
  const template = buildIncidentReportTemplate({
    requiereAsistencia: data.requiere_asistencia,
    vehiculoId: data.vehiculo_id,
    incidenteId: data.incidente_id,
    asignacionId: data.asignacion_id,
    conductorId: data.conductor_id,
    tipoIncidente: data.tipo_incidente,
    fechaReporte: data.fecha_reporte,
  });
  return createNotificationPlan({
    alert: {
      source_event_type: eventType,
      event_id: envelope.evento_id,
      type: Type.INCIDENT,
      severity: Severity.CRITICAL,
      reference_id: data.incidente_id,
    },
    notifications: [RecipientRole.FLEET_ADMINISTRATOR, RecipientRole.MAINTENANCE_TECHNICIAN].map(
      (role) => ({
        recipient_role: role,
        recipient_email: null,
        subject: template.subject,
        message: template.message,
        reference_id: data.incidente_id,
      }),
    ),
  });
};

module.exports = { eventType, buildPlan };
