const { z } = require('zod');
const { Type, Severity, RecipientRole } = require('../../domain/enums');
const { InvalidDataError } = require('../../domain/errors');
const { createNotificationPlan } = require('../shared/notification-plan');
const { buildIncidentReportTemplate } = require('../templates/incident-report.template');
const { parseEventData } = require('./event-data');
const { identifier, isoDate } = require('./event-fields');

const incidentDataSchema = z
  .object({
    incident_id: identifier,
    assignment_id: identifier,
    vehicle_id: identifier,
    driver_id: identifier,
    severity: z.enum(['minor', 'severe']),
    description: z.string().trim().min(1).max(500),
    reported_at: isoDate('reported_at debe ser ISO 8601'),
  })
  .passthrough();

const buildIncidentHandler = ({ eventType, severity, kind, expectedIncidentSeverity }) => ({
  eventType,
  buildPlan(envelope) {
    const data = parseEventData(incidentDataSchema, envelope.data, eventType);
    if (data.severity !== expectedIncidentSeverity) {
      throw new InvalidDataError('La severidad del evento no coincide con su tipo', [
        { campo: 'severity', codigo: 'MISMATCH' },
      ]);
    }
    const template = buildIncidentReportTemplate({
      kind,
      vehicleId: data.vehicle_id,
      incidentId: data.incident_id,
      assignmentId: data.assignment_id,
      driverId: data.driver_id,
      description: data.description,
      reportedAt: data.reported_at,
    });
    const roles =
      kind === 'MINOR'
        ? [RecipientRole.FLEET_ADMINISTRATOR]
        : [RecipientRole.FLEET_ADMINISTRATOR, RecipientRole.MAINTENANCE_TECHNICIAN];
    return createNotificationPlan({
      alert: {
        source_event_type: eventType,
        event_id: envelope.event_id,
        type: Type.INCIDENT,
        severity,
        reference_id: data.incident_id,
      },
      notifications: roles.map((role) => ({
        recipient_role: role,
        recipient_email: null,
        subject: template.subject,
        message: template.message,
        reference_id: data.incident_id,
      })),
    });
  },
});

const severeIncidentHandler = buildIncidentHandler({
  eventType: 'severe_incident_reported_event',
  severity: Severity.CRITICAL,
  kind: 'SEVERE',
  expectedIncidentSeverity: 'severe',
});

const minorIncidentHandler = buildIncidentHandler({
  eventType: 'minor_incident_reported_event',
  severity: Severity.WARNING,
  kind: 'MINOR',
  expectedIncidentSeverity: 'minor',
});

module.exports = { severeIncidentHandler, minorIncidentHandler, incidentDataSchema };
