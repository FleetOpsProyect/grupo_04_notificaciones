const { z } = require('zod');
const { Type, Severity, RecipientRole } = require('../../domain/enums');
const { createNotificationPlan } = require('../shared/notification-plan');
const { buildDocumentExpiringTemplate } = require('../templates/document-expiring.template');
const { parseEventData } = require('./event-data');
const {
  identifier,
  optionalIdentifier,
  optionalShortText,
  optionalIsoDate,
} = require('./event-fields');

const eventType = 'document_expiring_soon_event';
const documentExpiringSchema = z
  .object({
    document_id: identifier,
    document_type: optionalShortText,
    owner_type: optionalShortText,
    owner_id: optionalIdentifier,
    expiration_date: optionalIsoDate('expiration_date debe ser ISO 8601'),
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
    ownerId: data.owner_id,
    expirationDate: data.expiration_date,
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
