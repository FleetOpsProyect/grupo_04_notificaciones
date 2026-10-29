const { z } = require('zod');
const { Type, Severity, RecipientRole } = require('../../domain/enums');
const { createNotificationPlan } = require('../shared/notification-plan');
const { buildFuelAnomalyTemplate } = require('../templates/fuel-anomaly.template');
const { parseEventData } = require('./event-data');

const ALIAS_EVENT_TYPES = Object.freeze([
  'fuel_anomaly_detected_event',
  'ConsumoAnomaloDetectadoEvent',
]);

const fuelAnomalySchema = z
  .object({
    fuel_record_id: z.string().min(1).optional(),
    combustible_id: z.string().min(1).optional(),
    assignment_id: z.string().min(1).optional(),
    asignacion_id: z.string().min(1).optional(),
    vehicle_id: z.string().min(1).optional(),
    vehiculo_id: z.string().min(1).optional(),
    driver_id: z.string().min(1).optional(),
    route_id: z.string().min(1).optional(),
    ruta_id: z.string().min(1).optional(),
    efficiency_km_per_gallon: z.coerce.number().optional(),
    rendimiento: z.coerce.number().optional(),
    average_efficiency_km_per_gallon: z.coerce.number().optional(),
    rendimiento_promedio: z.coerce.number().optional(),
    gallons_purchased: z.coerce.number().optional(),
    galones_comprados: z.coerce.number().optional(),
    total_cost: z.coerce.number().optional(),
    costo_total: z.coerce.number().optional(),
    recorded_at: z.string().optional(),
    fecha_registro: z.string().optional(),
  })
  .passthrough();

const buildPlan = (envelope) => {
  const data = parseEventData(fuelAnomalySchema, envelope.data, envelope.event_type);
  const fuelRecordId = data.fuel_record_id ?? data.combustible_id ?? null;
  const template = buildFuelAnomalyTemplate({
    fuelRecordId,
    vehicleId: data.vehicle_id ?? data.vehiculo_id,
    efficiency: data.efficiency_km_per_gallon ?? data.rendimiento,
    averageEfficiency: data.average_efficiency_km_per_gallon ?? data.rendimiento_promedio,
    gallonsPurchased: data.gallons_purchased ?? data.galones_comprados,
  });
  return createNotificationPlan({
    alert: {
      source_event_type: envelope.event_type,
      event_id: envelope.event_id,
      type: Type.FUEL,
      severity: Severity.WARNING,
      reference_id: fuelRecordId,
    },
    notifications: [
      {
        recipient_role: RecipientRole.FLEET_ADMINISTRATOR,
        recipient_email: null,
        subject: template.subject,
        message: template.message,
        reference_id: fuelRecordId,
      },
    ],
  });
};

const fuelAnomalyHandler = {
  eventType: ALIAS_EVENT_TYPES[0],
  buildPlan,
};

const consumoAnomaloHandler = {
  eventType: ALIAS_EVENT_TYPES[1],
  buildPlan,
};

module.exports = {
  fuelAnomalyHandler,
  consumoAnomaloHandler,
  ALIAS_EVENT_TYPES,
  fuelAnomalySchema,
};
