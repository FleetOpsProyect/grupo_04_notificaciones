const { Notification } = require('../../src/domain/entities/notification');
const {
  AttentionStatus,
  DispatchStatus,
  Origin,
  RecipientRole,
  Severity,
  Type,
} = require('../../src/domain/enums');
const { InvalidDataError, NotificationNotFoundError } = require('../../src/domain/errors');
const { createTestContext, eventEnvelope, FIXED_NOW } = require('../helpers/test-context');

const manualInput = (overrides = {}) => ({
  type: Type.GENERAL,
  severity: Severity.INFORMATIONAL,
  recipient_role: RecipientRole.MANAGEMENT,
  message: 'Mensaje manual',
  correlation_id: 'corr-manual',
  ...overrides,
});

describe('ProcessDomainEvent', () => {
  test('procesa un evento y persiste alerta, notificaciones e idempotencia', async () => {
    const context = createTestContext();
    const result = await context.useCases.processDomainEvent(eventEnvelope(), {
      topic: 'topic',
      partition: 0,
      offset: '10',
    });
    expect(result.status).toBe('processed');
    expect(result.notification_ids).toHaveLength(2);
    expect(context.state.alerts.size).toBe(1);
    expect(context.state.notifications.size).toBe(2);
    expect(context.state.processedEvents.size).toBe(1);
    expect(context.state.alerts.get(result.alert_id).severity).toBe(Severity.CRITICAL);
  });

  test('descarta un evento duplicado sin reescribir', async () => {
    const context = createTestContext();
    const first = await context.useCases.processDomainEvent(eventEnvelope());
    const second = await context.useCases.processDomainEvent(eventEnvelope());
    expect(first.status).toBe('processed');
    expect(second).toEqual({
      status: 'duplicate',
      event_id: eventEnvelope().evento_id,
    });
    expect(context.state.notifications.size).toBe(2);
  });

  test('ignora eventos con contrato pendiente y tipos desconocidos', async () => {
    const context = createTestContext();
    const pendingResult = await context.useCases.processDomainEvent(
      eventEnvelope({ tipo_evento: 'IncidenteLeveRegistradoEvent' }),
    );
    const unknownResult = await context.useCases.processDomainEvent(
      eventEnvelope({ tipo_evento: 'EventoNoRegistrado' }),
    );
    expect(pendingResult).toEqual({ status: 'ignored', reason: 'pending_contract' });
    expect(unknownResult).toEqual({ status: 'ignored', reason: 'unsupported_event_type' });
    expect(context.state.notifications.size).toBe(0);
  });

  test('revierte la transacción si los datos del evento son inválidos', async () => {
    const context = createTestContext();
    const envelope = eventEnvelope({ datos: { vehiculo_id: 'VEH-1' } });
    await expect(context.useCases.processDomainEvent(envelope)).rejects.toBeInstanceOf(
      InvalidDataError,
    );
    expect(context.state.alerts.size).toBe(0);
    expect(context.state.processedEvents.size).toBe(0);
  });
});

describe('CreateManualNotification', () => {
  test('crea alerta y notificación manual pendiente', async () => {
    const context = createTestContext();
    const result = await context.useCases.createManualNotification(manualInput());
    expect(result.dispatch_status).toBe(DispatchStatus.PENDING_DISPATCH);
    expect(context.state.alerts.size).toBe(1);
    expect(context.state.notifications.size).toBe(1);
    const notification = [...context.state.notifications.values()][0];
    expect(notification.origin).toBe(Origin.MANUAL);
    expect(notification.recipient_email).toBeNull();
    expect(notification.attention_status).toBe(AttentionStatus.PENDING);
  });

  test('rechaza el rol EMPLOYEE', async () => {
    const context = createTestContext();
    await expect(
      context.useCases.createManualNotification(
        manualInput({ recipient_role: RecipientRole.EMPLOYEE }),
      ),
    ).rejects.toBeInstanceOf(InvalidDataError);
  });

  test('incluye referencia cuando se informa', async () => {
    const context = createTestContext();
    const result = await context.useCases.createManualNotification(
      manualInput({ reference_id: 'REF-1', message: 'Texto' }),
    );
    expect(context.state.notifications.get(result.notification_id).reference_id).toBe('REF-1');
  });
});

describe('consultas', () => {
  test('entrega el estado agregado', async () => {
    const context = createTestContext();
    await context.useCases.processDomainEvent(eventEnvelope());
    await context.useCases.createManualNotification(manualInput());
    const status = await context.useCases.getNotificationStatus();
    expect(status.alertas_criticas_pendientes).toBe(1);
    expect(status.total_notifications).toBe(3);
    expect(status.by_severity.CRITICAL).toBe(2);
    expect(status.dispatch).toEqual({ pending: 3, sent: 0, failed: 0 });
    expect(status.generated_at).toBe('2026-10-22T10:00:00-05:00');
  });

  test('lista con filtros, paginación y resumen', async () => {
    const context = createTestContext();
    await context.useCases.processDomainEvent(eventEnvelope());
    await context.useCases.createManualNotification(manualInput());
    const all = await context.useCases.listNotifications({
      page: 0,
      size: 2,
      severity: undefined,
      type: undefined,
    });
    expect(all.total).toBe(3);
    expect(all.contenido).toHaveLength(2);
    expect(all.resumen.by_severity.CRITICAL).toBe(2);
    expect(all.resumen.by_dispatch_status.PENDING_DISPATCH).toBe(3);
    const filtered = await context.useCases.listNotifications({
      page: 0,
      size: 20,
      severity: Severity.INFORMATIONAL,
      type: Type.GENERAL,
    });
    expect(filtered.total).toBe(1);
    expect(filtered.contenido[0].severity).toBe(Severity.INFORMATIONAL);
    const secondPage = await context.useCases.listNotifications({
      page: 1,
      size: 2,
    });
    expect(secondPage.contenido).toHaveLength(1);
  });

  test('rechaza fechas de filtro inválidas', async () => {
    const context = createTestContext();
    await expect(
      context.useCases.listNotifications({ date_from: 'no-date' }),
    ).rejects.toBeInstanceOf(InvalidDataError);
  });

  test('obtiene una notificación y enmascara el correo', async () => {
    const context = createTestContext();
    const processed = await context.useCases.processDomainEvent(
      eventEnvelope({
        tipo_evento: 'AsignacionInterrumpidaEvent',
        datos: { empleado_email: 'empleado@example.com', resultado: 'MANUAL_REQUERIDA' },
      }),
    );
    const result = await context.useCases.getNotification(processed.notification_ids[0]);
    expect(result.recipient_email).toBe('e***@example.com');
    expect(result.message).toContain('gestión manual');
  });

  test('falla cuando la notificación no existe', async () => {
    const context = createTestContext();
    await expect(
      context.useCases.getNotification('00000000-0000-4000-8000-000000000099'),
    ).rejects.toBeInstanceOf(NotificationNotFoundError);
  });
});

describe('MarkAlertAttended', () => {
  test('atiende la alerta y todas sus notificaciones de forma idempotente', async () => {
    const context = createTestContext();
    const processed = await context.useCases.processDomainEvent(eventEnvelope());
    const first = await context.useCases.markAlertAttended(processed.notification_ids[0]);
    expect(first.attention_status).toBe(AttentionStatus.ATTENDED);
    for (const notification of context.state.notifications.values()) {
      expect(notification.attention_status).toBe(AttentionStatus.ATTENDED);
    }
    const second = await context.useCases.markAlertAttended(processed.notification_ids[1]);
    expect(second.attended_at).toBe(first.attended_at);
  });

  test('falla si la notificación o su alerta no existen', async () => {
    const context = createTestContext();
    await expect(
      context.useCases.markAlertAttended('00000000-0000-4000-8000-000000000099'),
    ).rejects.toBeInstanceOf(NotificationNotFoundError);

    const orphan = new Notification({
      notification_id: '00000000-0000-4000-8000-000000000098',
      alert_id: 'missing-alert',
      type: Type.GENERAL,
      severity: Severity.INFORMATIONAL,
      recipient_role: RecipientRole.MANAGEMENT,
      subject: 'Asunto',
      message: 'Mensaje',
      origin: Origin.MANUAL,
      correlation_id: 'corr',
      next_attempt_at: FIXED_NOW,
      created_at: FIXED_NOW,
    });
    context.state.notifications.set(orphan.notification_id, orphan);
    await expect(context.useCases.markAlertAttended(orphan.notification_id)).rejects.toBeInstanceOf(
      NotificationNotFoundError,
    );
  });
});
