const { z } = require('zod');
const { Type, Severity, RecipientRole } = require('../../domain/enums');
const { createNotificationPlan } = require('../shared/notification-plan');
const { buildDocumentExpiredTemplate } = require('../templates/document-expired.template');
const { parseEventData } = require('./event-data');

const eventType = 'document_expired_event';
const documentExpiredSchema = z
  .object({
    document_id: z.string().min(1),
    document_type: z.string().min(1).optional(),
    owner_type: z.string().min(1).optional(),
    owner_id: z.string().min(1).optional(),
    expiration_date: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        message: 'expiration_date debe ser ISO 8601',
      })
      .optional(),
  })
  .passthrough();

const buildPlan = (envelope) => {
  const data = parseEventData(documentExpiredSchema, envelope.data, eventType);
  const template = buildDocumentExpiredTemplate({
    documentId: data.document_id,
    documentType: data.document_type,
    ownerType: data.owner_type,
    expirationDate: data.expiration_date,
  });
  return createNotificationPlan({
    alert: {
      source_event_type: eventType,
      event_id: envelope.event_id,
      type: Type.DOCUMENT,
      severity: Severity.CRITICAL,
      reference_id: data.document_id,
    },
    notifications: [
      {
        recipient_role: RecipientRole.FLEET_ADMINISTRATOR,
        recipient_email: null,
        subject: template.subject,
        message: template.message,
        reference_id: data.document_id,
      },
    ],
  });
};

module.exports = { eventType, buildPlan, documentExpiredSchema };
