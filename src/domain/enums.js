const Type = Object.freeze({
  INCIDENT: 'INCIDENT',
  ASSIGNMENT: 'ASSIGNMENT',
  DOCUMENT: 'DOCUMENT',
  MAINTENANCE: 'MAINTENANCE',
  FUEL: 'FUEL',
  GENERAL: 'GENERAL',
});

const Severity = Object.freeze({
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
});

const Origin = Object.freeze({
  EVENT: 'EVENT',
  MANUAL: 'MANUAL',
});

const AcknowledgementStatus = Object.freeze({
  PENDING: 'PENDING',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
});

const DeliveryStatus = Object.freeze({
  PENDING: 'PENDING',
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
  AcknowledgementStatus,
  DeliveryStatus,
  RecipientRole,
  TYPE_VALUES: values(Type),
  SEVERITY_VALUES: values(Severity),
  ORIGIN_VALUES: values(Origin),
  ACKNOWLEDGEMENT_STATUS_VALUES: values(AcknowledgementStatus),
  DELIVERY_STATUS_VALUES: values(DeliveryStatus),
  RECIPIENT_ROLE_VALUES: values(RecipientRole),
};
