const { z } = require('zod');
const { Type, Severity, RecipientRole } = require('../../domain/enums');
const { createNotificationPlan } = require('../shared/notification-plan');
const { buildMaintenanceRequiredTemplate } = require('../templates/maintenance-required.template');
const { parseEventData } = require('./event-data');
const { identifier } = require('./event-fields');

const eventType = 'preventive_maintenance_required_event';
const maintenanceSchema = z
  .object({
    maintenance_order_id: identifier,
    vehicle_id: identifier,
    current_mileage: z.coerce.number().int().nonnegative(),
    threshold_km: z.coerce.number().int().positive(),
    trigger_reason: z.string().trim().min(1).max(100),
  })
  .passthrough();

const TRIGGER_REASON_LABELS = Object.freeze({
  MILEAGE_EXCEEDED: 'Kilometraje excedido',
});

const describeTriggerReason = (triggerReason) =>
  TRIGGER_REASON_LABELS[triggerReason] ?? triggerReason;

const buildPlan = (envelope) => {
  const data = parseEventData(maintenanceSchema, envelope.data, eventType);
  const template = buildMaintenanceRequiredTemplate({
    currentMileage: data.current_mileage,
    thresholdKm: data.threshold_km,
    triggerReason: describeTriggerReason(data.trigger_reason),
    vehicleId: data.vehicle_id,
    maintenanceOrderId: data.maintenance_order_id,
  });
  return createNotificationPlan({
    alert: {
      source_event_type: eventType,
      event_id: envelope.event_id,
      type: Type.MAINTENANCE,
      severity: Severity.WARNING,
      reference_id: data.maintenance_order_id,
    },
    notifications: [RecipientRole.FLEET_ADMINISTRATOR, RecipientRole.MAINTENANCE_TECHNICIAN].map(
      (role) => ({
        recipient_role: role,
        recipient_email: null,
        subject: template.subject,
        message: template.message,
        reference_id: data.maintenance_order_id,
      }),
    ),
  });
};

module.exports = {
  eventType,
  buildPlan,
  maintenanceSchema,
  TRIGGER_REASON_LABELS,
  describeTriggerReason,
};
