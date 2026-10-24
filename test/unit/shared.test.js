const { maskEmail } = require('../../src/application/shared/mask-email');
const {
  formatBogotaIso,
  formatBogotaText,
  parseIsoDate,
} = require('../../src/application/shared/time');
const { createNotificationPlan } = require('../../src/application/shared/notification-plan');
const { toNotificationView } = require('../../src/application/shared/notification-view');
const {
  safeNotificationLogFields,
  safeErrorFields,
} = require('../../src/application/shared/safe-log-fields');
const {
  buildIncidentReportTemplate,
} = require('../../src/application/templates/incident-report.template');
const {
  buildAssignmentInterruptedTemplate,
} = require('../../src/application/templates/assignment-interrupted.template');
const {
  buildDocumentExpiringTemplate,
} = require('../../src/application/templates/document-expiring.template');
const {
  buildDocumentExpiredTemplate,
} = require('../../src/application/templates/document-expired.template');
const {
  buildMaintenanceRequiredTemplate,
  formatKilometers,
} = require('../../src/application/templates/maintenance-required.template');
const {
  buildManualNotificationTemplate,
} = require('../../src/application/templates/manual-notification.template');
const { Origin, RecipientRole, Severity, Type } = require('../../src/domain/enums');
const { Notification } = require('../../src/domain/entities/notification');

const NOW = new Date('2026-10-22T15:00:00.000Z');

describe('shared helpers', () => {
  test('enmascara correos y tolera valores inválidos', () => {
    expect(maskEmail('persona@example.com')).toBe('p***@example.com');
    expect(maskEmail('@example.com')).toBeNull();
    expect(maskEmail('persona@')).toBeNull();
    expect(maskEmail(null)).toBeNull();
  });

  test('formatea fechas de Bogotá', () => {
    expect(formatBogotaIso(NOW)).toBe('2026-10-22T10:00:00-05:00');
    expect(formatBogotaIso(null)).toBeNull();
    expect(formatBogotaIso('no-date')).toBeNull();
    expect(formatBogotaText(NOW)).toBe('2026-10-22 10:00:00 (GMT-5)');
    expect(formatBogotaText(null)).toBe('fecha no disponible');
    expect(parseIsoDate('2026-10-22T15:00:00Z')).toEqual(NOW);
    expect(parseIsoDate('no-date')).toBeNull();
  });

  test('valida el plan de notificación', () => {
    expect(() => createNotificationPlan({ alert: null, notifications: [] })).toThrow();
    expect(() => createNotificationPlan({ alert: {}, notifications: [] })).toThrow();
    expect(createNotificationPlan({ alert: {}, notifications: [{}] })).toEqual({
      alert: {},
      notifications: [{}],
    });
  });

  test('construye la vista y los campos de log seguros', () => {
    const notification = new Notification({
      notification_id: 'n-1',
      alert_id: 'a-1',
      type: Type.ASSIGNMENT,
      severity: Severity.WARNING,
      recipient_role: RecipientRole.EMPLOYEE,
      recipient_email: 'persona@example.com',
      subject: 'Asunto',
      message: 'Mensaje',
      origin: Origin.EVENT,
      correlation_id: 'c-1',
      next_attempt_at: NOW,
      created_at: NOW,
    });
    expect(toNotificationView(notification).recipient_email).toBe('p***@example.com');
    expect(toNotificationView(notification, 'otro@example.com').recipient_email).toBe(
      'o***@example.com',
    );
    expect(
      toNotificationView({ ...notification, recipient_email: null }).recipient_email,
    ).toBeNull();
    expect(safeNotificationLogFields(notification).recipient_email).toBe('p***@example.com');
    expect(safeErrorFields(new Error('fallo'))).toMatchObject({
      error_name: 'Error',
      error_message: 'fallo',
    });
    expect(safeErrorFields(null)).toEqual({
      error_name: 'UnknownError',
      error_code: 'UNKNOWN',
      error_message: 'Error desconocido',
    });
  });
});

describe('templates', () => {
  test('incidente con y sin datos opcionales', () => {
    const full = buildIncidentReportTemplate({
      requiereAsistencia: true,
      vehiculoId: 'VEH-1',
      incidenteId: 'INC-1',
      asignacionId: 'ASI-1',
      conductorId: 'CON-1',
      tipoIncidente: 'Choque',
      fechaReporte: NOW,
    });
    expect(full.subject).toContain('[URGENTE]');
    expect(full.message).toContain('Asignación: ASI-1');
    expect(full.message).toContain('REQUIERE ASISTENCIA INMEDIATA');
    const minimal = buildIncidentReportTemplate({
      requiereAsistencia: false,
      vehiculoId: 'VEH-1',
      incidenteId: 'INC-1',
      tipoIncidente: 'Falla',
      fechaReporte: 'no-date',
    });
    expect(minimal.subject).not.toContain('[URGENTE]');
    expect(minimal.message).toContain('fecha no disponible');
  });

  test('asignación interrumpida cubre los resultados', () => {
    expect(buildAssignmentInterruptedTemplate({ resultado: 'MANUAL_REQUERIDA' }).message).toContain(
      'gestión manual',
    );
    expect(
      buildAssignmentInterruptedTemplate({ resultado: 'AUTOMATICA_FALLIDA' }).message,
    ).toContain('reasignación automática falló');
    expect(
      buildAssignmentInterruptedTemplate({ resultado: 'AUTOMATICA_EXITOSA' }).message,
    ).toContain('fue exitosa');
    expect(buildAssignmentInterruptedTemplate({}).message).toContain('pendiente');
  });

  test('documentos próximos y vencidos', () => {
    const expiring = buildDocumentExpiringTemplate({
      diasRestantes: 15,
      documentoId: 'DOC-1',
      entidadTipo: 'VEHICLE',
    });
    expect(expiring.subject).toContain('15 días');
    expect(expiring.message).toContain('DOC-1');
    expect(expiring.message).toContain('VEHICLE');
    expect(buildDocumentExpiringTemplate({ diasRestantes: 5 }).message).not.toContain(
      'Entidad asociada',
    );
    const expired = buildDocumentExpiredTemplate({
      documentoId: 'DOC-1',
      entidadTipo: 'VEHICLE',
    });
    expect(expired.message).toContain('DOC-1');
    expect(expired.message).toContain('VEHICLE');
    expect(buildDocumentExpiredTemplate({}).message).not.toContain('Entidad asociada');
  });

  test('mantenimiento formatea kilómetros y omite datos', () => {
    expect(formatKilometers(12345.6)).toBe('12.346');
    expect(formatKilometers(Number.NaN)).toBeNull();
    const full = buildMaintenanceRequiredTemplate({
      kilometros: 12345,
      vehiculoId: 'VEH-1',
      mantenimientoId: 'MAN-1',
    });
    expect(full.subject).toContain('VEH-1');
    expect(full.message).toContain('12.345 km');
    const minimal = buildMaintenanceRequiredTemplate({});
    expect(minimal.subject).not.toContain(' para ');
    expect(minimal.message).not.toContain('Kilometraje');
  });

  test('notificación manual con referencia opcional', () => {
    const template = buildManualNotificationTemplate({
      type: Type.GENERAL,
      severity: Severity.INFORMATIONAL,
      message: '  Hola  ',
      referenceId: 'REF-1',
      createdAt: NOW,
    });
    expect(template.message.startsWith('Hola')).toBe(true);
    expect(template.message).toContain('Referencia: REF-1');
    expect(template.message).toContain('Fecha:');
  });
});
