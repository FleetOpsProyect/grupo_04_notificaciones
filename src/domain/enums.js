const Type = Object.freeze({
  INCIDENT: 'INCIDENT',
  ASSIGNMENT: 'ASSIGNMENT',
  DOCUMENT: 'DOCUMENT',
  MAINTENANCE: 'MAINTENANCE',
  FUEL: 'FUEL',
  GENERAL: 'GENERAL',
});

const Severity = Object.freeze({
  INFORMATIONAL: 'INFORMATIONAL',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
});

const Origin = Object.freeze({
  EVENT: 'EVENT',
  MANUAL: 'MANUAL',
});

const AttentionStatus = Object.freeze({
  PENDING: 'PENDING',
  ATTENDED: 'ATTENDED',
});

const DispatchStatus = Object.freeze({
  PENDING_DISPATCH: 'PENDING_DISPATCH',
  SENT: 'SENT',
  FAILED: 'FAILED',
});

const RecipientRole = Object.freeze({
  FLEET_ADMINISTRATOR: 'FLEET_ADMINISTRATOR',
  MAINTENANCE_TECHNICIAN: 'MAINTENANCE_TECHNICIAN',
  MANAGEMENT: 'MANAGEMENT',
  EMPLOYEE: 'EMPLOYEE',
});

const values = (object) => Object.freeze(Object.values(object));

module.exports = {
  Type,
  Severity,
  Origin,
  AttentionStatus,
  DispatchStatus,
  RecipientRole,
  TYPE_VALUES: values(Type),
  SEVERITY_VALUES: values(Severity),
  ORIGIN_VALUES: values(Origin),
  ATTENTION_STATUS_VALUES: values(AttentionStatus),
  DISPATCH_STATUS_VALUES: values(DispatchStatus),
  RECIPIENT_ROLE_VALUES: values(RecipientRole),
};
