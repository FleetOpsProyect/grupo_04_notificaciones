const { z } = require('zod');
const { Type, Severity, RecipientRole } = require('../../domain/enums');
const { createNotificationPlan } = require('../shared/notification-plan');
const { buildDocumentExpiringTemplate } = require('../templates/document-expiring.template');
const { parseEventData } = require('./event-data');

const eventType = 'document_expiring_soon_event';
const documentExpiringSchema = z
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
    threshold_days: z.coerce.number().int().optional(),
    days_remaining: z.coerce.number().int().min(0),
  })
  .passthrough();

const buildPlan = (envelope) => {
  const data = parseEventData(documentExpiringSchema, envelope.data, eventType);
  const template = buildDocumentExpiringTemplate({
    daysRemaining: data.days_remaining,
    documentId: data.document_id,
    documentType: data.document_type,
    ownerType: data.owner_type,
    thresholdDays: data.threshold_days,
  });
  return createNotificationPlan({
    alert: {
      source_event_type: eventType,
      event_id: envelope.event_id,
      type: Type.DOCUMENT,
      severity: Severity.WARNING,
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

module.exports = { eventType, buildPlan, documentExpiringSchema };
