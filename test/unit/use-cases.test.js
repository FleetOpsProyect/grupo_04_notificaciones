const { Notification } = require('../../src/domain/entities/notification');
const {
  AcknowledgementStatus,
  DeliveryStatus,
  Origin,
  RecipientRole,
  Severity,
  Type,
} = require('../../src/domain/enums');
const { InvalidDataError, NotificationNotFoundError } = require('../../src/domain/errors');
const { createTestContext, eventEnvelope, FIXED_NOW } = require('../helpers/test-context');

const manualInput = (overrides = {}) => ({
  type: Type.GENERAL,
  severity: Severity.INFO,
  recipient_role: RecipientRole.MANAGEMENT,
  message: 'Mensaje manual',
  correlation_id: 'corr-manual',
  ...overrides,
});

describe('ProcessDomainEvent', () => {
  test('procesa un evento y persiste alerta, notificaciones e idempotencia', async () => {
    const context = createTestContext();
    const result = await context.useCases.processDomainEvent(eventEnvelope(), {
      queue_url: 'http://localhost/queue',
      message_id: 'msg-1',
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
      event_id: eventEnvelope().event_id,
    });
    expect(context.state.notifications.size).toBe(2);
  });

  test('ignora eventos sin aviso y tipos desconocidos', async () => {
    const context = createTestContext();
    const ignoredResult = await context.useCases.processDomainEvent(
      eventEnvelope({ event_type: 'assignment_created_event' }),
    );
    const unknownResult = await context.useCases.processDomainEvent(
      eventEnvelope({ event_type: 'EventoNoRegistrado' }),
    );
    expect(ignoredResult).toEqual({ status: 'ignored', reason: 'unsupported_event_type' });
    expect(unknownResult).toEqual({ status: 'ignored', reason: 'unsupported_event_type' });
    expect(context.state.notifications.size).toBe(0);
  });

  test('revierte la transacción si los datos del evento son inválidos', async () => {
    const context = createTestContext();
    const envelope = eventEnvelope({ data: { vehiculo_id: 'VEH-1' } });
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
    expect(result.delivery_status).toBe(DeliveryStatus.PENDING);
    expect(context.state.alerts.size).toBe(1);
    expect(context.state.notifications.size).toBe(1);
    const notification = [...context.state.notifications.values()][0];
    expect(notification.origin).toBe(Origin.MANUAL);
    expect(notification.recipient_email).toBeNull();
    expect(notification.acknowledgement_status).toBe(AcknowledgementStatus.PENDING);
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
    expect(status.critical_alerts_pending).toBe(1);
    expect(status.total_notifications).toBe(3);
    expect(status.by_severity.CRITICAL).toBe(2);
    expect(status.deliveries).toEqual({ pending: 3, sent: 0, failed: 0 });
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
    expect(all.content).toHaveLength(2);
    expect(all.summary.by_severity.CRITICAL).toBe(2);
    expect(all.summary.by_delivery_status.PENDING).toBe(3);
    const filtered = await context.useCases.listNotifications({
      page: 0,
      size: 20,
      severity: Severity.INFO,
      type: Type.GENERAL,
    });
    expect(filtered.total).toBe(1);
    expect(filtered.content[0].severity).toBe(Severity.INFO);
    const secondPage = await context.useCases.listNotifications({
      page: 1,
      size: 2,
    });
    expect(secondPage.content).toHaveLength(1);
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
        event_type: 'interrupted_assignment_event',
        data: {
          assignment_id: 'ASG-1',
          employee_email: 'empleado@example.com',
          reassignment_result: 'MANUAL_REQUIRED',
        },
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

describe('AcknowledgeAlert', () => {
  test('reconoce la alerta y todas sus notificaciones de forma idempotente', async () => {
    const context = createTestContext();
    const processed = await context.useCases.processDomainEvent(eventEnvelope());
    const first = await context.useCases.acknowledgeAlert(processed.notification_ids[0]);
    expect(first.acknowledgement_status).toBe(AcknowledgementStatus.ACKNOWLEDGED);
    for (const notification of context.state.notifications.values()) {
      expect(notification.acknowledgement_status).toBe(AcknowledgementStatus.ACKNOWLEDGED);
    }
    const second = await context.useCases.acknowledgeAlert(processed.notification_ids[1]);
    expect(second.acknowledged_at).toBe(first.acknowledged_at);
  });

  test('falla si la notificación o su alerta no existen', async () => {
    const context = createTestContext();
    await expect(
      context.useCases.acknowledgeAlert('00000000-0000-4000-8000-000000000099'),
    ).rejects.toBeInstanceOf(NotificationNotFoundError);

    const orphan = new Notification({
      notification_id: '00000000-0000-4000-8000-000000000098',
      alert_id: 'missing-alert',
      type: Type.GENERAL,
      severity: Severity.INFO,
      recipient_role: RecipientRole.MANAGEMENT,
      subject: 'Asunto',
      message: 'Mensaje',
      origin: Origin.MANUAL,
      correlation_id: 'corr',
      next_attempt_at: FIXED_NOW,
      created_at: FIXED_NOW,
    });
    context.state.notifications.set(orphan.notification_id, orphan);
    await expect(context.useCases.acknowledgeAlert(orphan.notification_id)).rejects.toBeInstanceOf(
      NotificationNotFoundError,
    );
  });
});
