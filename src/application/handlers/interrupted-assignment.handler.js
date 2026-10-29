const { z } = require('zod');
const { Type, Severity, RecipientRole } = require('../../domain/enums');
const { normalizeRecipientEmail } = require('../../domain/value-objects/recipient-email');
const { createNotificationPlan } = require('../shared/notification-plan');
const {
  buildAssignmentInterruptedTemplate,
} = require('../templates/assignment-interrupted.template');
const { parseEventData } = require('./event-data');

const eventType = 'interrupted_assignment_event';
const assignmentDataSchema = z
  .object({
    assignment_id: z.string().min(1),
    vehicle_id: z.string().min(1).optional(),
    driver_id: z.string().min(1).optional(),
    employee_id: z.string().min(1).optional(),
    employee_email: z.string().min(1),
    incident_id: z.string().min(1).optional(),
    reassignment_result: z
      .enum(['MANUAL_REQUIRED', 'AUTOMATIC_SUCCESSFUL', 'AUTOMATIC_FAILED'])
      .optional(),
    new_assignment_id: z.string().min(1).optional(),
  })
  .passthrough();

const buildPlan = (envelope) => {
  const data = parseEventData(assignmentDataSchema, envelope.data, eventType);
  const recipientEmail = normalizeRecipientEmail(data.employee_email);
  const severity =
    data.reassignment_result === 'AUTOMATIC_SUCCESSFUL' ? Severity.INFO : Severity.WARNING;
  const template = buildAssignmentInterruptedTemplate({
    reassignmentResult: data.reassignment_result,
    newAssignmentId: data.new_assignment_id,
  });
  return createNotificationPlan({
    alert: {
      source_event_type: eventType,
      event_id: envelope.event_id,
      type: Type.ASSIGNMENT,
      severity,
      reference_id: data.assignment_id,
    },
    notifications: [
      {
        recipient_role: RecipientRole.EMPLOYEE,
        recipient_email: recipientEmail,
        subject: template.subject,
        message: template.message,
        reference_id: data.assignment_id,
      },
    ],
  });
};

module.exports = { eventType, buildPlan, assignmentDataSchema };
