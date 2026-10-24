const { z } = require('zod');
const { Type, Severity, RecipientRole } = require('../../domain/enums');
const { normalizeRecipientEmail } = require('../../domain/value-objects/recipient-email');
const { createNotificationPlan } = require('../shared/notification-plan');
const {
  buildAssignmentInterruptedTemplate,
} = require('../templates/assignment-interrupted.template');
const { parseEventData } = require('./event-data');

const eventType = 'AsignacionInterrumpidaEvent';
const assignmentDataSchema = z
  .object({
    empleado_email: z.string().min(1),
    resultado: z.enum(['MANUAL_REQUERIDA', 'AUTOMATICA_FALLIDA', 'AUTOMATICA_EXITOSA']).optional(),
    asignacion_id: z.string().min(1).optional(),
  })
  .passthrough();

const buildPlan = (envelope) => {
  const data = parseEventData(assignmentDataSchema, envelope.datos, eventType);
  const recipientEmail = normalizeRecipientEmail(data.empleado_email);
  const severity =
    data.resultado === 'AUTOMATICA_EXITOSA' ? Severity.INFORMATIONAL : Severity.WARNING;
  const template = buildAssignmentInterruptedTemplate({ resultado: data.resultado });
  return createNotificationPlan({
    alert: {
      source_event_type: eventType,
      event_id: envelope.evento_id,
      type: Type.ASSIGNMENT,
      severity,
      reference_id: data.asignacion_id ?? null,
    },
    notifications: [
      {
        recipient_role: RecipientRole.EMPLOYEE,
        recipient_email: recipientEmail,
        subject: template.subject,
        message: template.message,
        reference_id: data.asignacion_id ?? null,
      },
    ],
  });
};

module.exports = { eventType, buildPlan };
