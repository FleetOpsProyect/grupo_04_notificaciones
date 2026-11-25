const { z } = require('zod');
const { Type, Severity, RecipientRole } = require('../../domain/enums');
const { createNotificationPlan } = require('../shared/notification-plan');
const { buildDocumentExpiredTemplate } = require('../templates/document-expired.template');
const { parseEventData } = require('./event-data');
const {
  identifier,
  optionalIdentifier,
  optionalShortText,
  optionalIsoDate,
} = require('./event-fields');

const eventType = 'document_expired_event';
const documentExpiredSchema = z
  .object({
    document_id: identifier,
    document_type: optionalShortText,
    owner_type: optionalShortText,
    owner_id: optionalIdentifier,
    expiration_date: optionalIsoDate('expiration_date debe ser ISO 8601'),
  })
  .passthrough();

const buildPlan = (envelope) => {
  const data = parseEventData(documentExpiredSchema, envelope.data, eventType);
  const template = buildDocumentExpiredTemplate({
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
