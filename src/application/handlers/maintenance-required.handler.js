const { z } = require('zod');
const { Type, Severity, RecipientRole } = require('../../domain/enums');
const { createNotificationPlan } = require('../shared/notification-plan');
const { buildMaintenanceRequiredTemplate } = require('../templates/maintenance-required.template');
const { parseEventData } = require('./event-data');

const eventType = 'MantenimientoPreventivoRequeridoEvent';
const maintenanceSchema = z
  .object({
    mantenimiento_id: z.string().min(1).optional(),
    vehiculo_id: z.string().min(1).optional(),
    kilometraje_actual: z.coerce.number().nonnegative().optional(),
    umbral_km: z.coerce.number().nonnegative().optional(),
    motivo: z.string().min(1).optional(),
  })
  .passthrough();

const buildPlan = (envelope) => {
  const data = parseEventData(maintenanceSchema, envelope.data, eventType);
  const referenceId = data.mantenimiento_id ?? null;
  const template = buildMaintenanceRequiredTemplate({
    kilometrajeActual: data.kilometraje_actual,
    umbralKm: data.umbral_km,
    motivo: data.motivo,
    vehiculoId: data.vehiculo_id,
    mantenimientoId: data.mantenimiento_id,
  });
  return createNotificationPlan({
    alert: {
      source_event_type: eventType,
      event_id: envelope.event_id,
      type: Type.MAINTENANCE,
      severity: Severity.WARNING,
      reference_id: referenceId,
    },
    notifications: [RecipientRole.FLEET_ADMINISTRATOR, RecipientRole.MAINTENANCE_TECHNICIAN].map(
      (role) => ({
        recipient_role: role,
        recipient_email: null,
        subject: template.subject,
        message: template.message,
        reference_id: referenceId,
      }),
    ),
  });
};

module.exports = { eventType, buildPlan, maintenanceSchema };
