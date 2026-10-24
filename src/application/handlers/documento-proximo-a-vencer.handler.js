const { z } = require('zod');
const { Type, Severity, RecipientRole } = require('../../domain/enums');
const { createNotificationPlan } = require('../shared/notification-plan');
const { buildDocumentExpiringTemplate } = require('../templates/document-expiring.template');
const { parseEventData } = require('./event-data');

const eventType = 'DocumentoProximoAVencerEvent';
const documentExpiringSchema = z
  .object({
    dias_restantes: z.coerce
      .number()
      .int()
      .refine((value) => [30, 15, 5].includes(value), {
        message: 'dias_restantes debe ser 30, 15 o 5',
      }),
    documento_id: z.string().min(1).optional(),
    entidad_tipo: z.string().min(1).optional(),
  })
  .passthrough();

const buildPlan = (envelope) => {
  const data = parseEventData(documentExpiringSchema, envelope.datos, eventType);
  const referenceId = data.documento_id ?? null;
  const template = buildDocumentExpiringTemplate({
    diasRestantes: data.dias_restantes,
    documentoId: data.documento_id,
    entidadTipo: data.entidad_tipo,
  });
  return createNotificationPlan({
    alert: {
      source_event_type: eventType,
      event_id: envelope.evento_id,
      type: Type.DOCUMENT,
      severity: Severity.WARNING,
      reference_id: referenceId,
    },
    notifications: [
      {
        recipient_role: RecipientRole.FLEET_ADMINISTRATOR,
        recipient_email: null,
        subject: template.subject,
        message: template.message,
        reference_id: referenceId,
      },
    ],
  });
};

module.exports = { eventType, buildPlan };
