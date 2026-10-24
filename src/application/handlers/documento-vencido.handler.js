const { z } = require('zod');
const { Type, Severity, RecipientRole } = require('../../domain/enums');
const { createNotificationPlan } = require('../shared/notification-plan');
const { buildDocumentExpiredTemplate } = require('../templates/document-expired.template');
const { parseEventData } = require('./event-data');

const eventType = 'DocumentoVencidoEvent';
const documentExpiredSchema = z
  .object({
    documento_id: z.string().min(1).optional(),
    entidad_tipo: z.string().min(1).optional(),
  })
  .passthrough();

const buildPlan = (envelope) => {
  const data = parseEventData(documentExpiredSchema, envelope.datos, eventType);
  const referenceId = data.documento_id ?? null;
  const template = buildDocumentExpiredTemplate({
    documentoId: data.documento_id,
    entidadTipo: data.entidad_tipo,
  });
  return createNotificationPlan({
    alert: {
      source_event_type: eventType,
      event_id: envelope.evento_id,
      type: Type.DOCUMENT,
      severity: Severity.CRITICAL,
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
