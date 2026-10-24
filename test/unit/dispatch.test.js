const { Notification } = require('../../src/domain/entities/notification');
const { DispatchStatus } = require('../../src/domain/enums');
const { EmailDeliveryError } = require('../../src/domain/errors');
const { createTestContext, eventEnvelope, FIXED_NOW } = require('../helpers/test-context');

const prepareIncident = async (context) => {
  const result = await context.useCases.processDomainEvent(eventEnvelope());
  return result.notification_ids;
};

describe('DispatchPendingNotifications', () => {
  test('envía las notificaciones pendientes y las marca SENT', async () => {
    const context = createTestContext();
    const ids = await prepareIncident(context);
    const result = await context.useCases.dispatchPendingNotifications({ limit: 10 });
    expect(result).toMatchObject({ claimed: 2, sent: 2, failed: 0, retried: 0 });
    expect(context.emailSender.send).toHaveBeenCalledTimes(2);
    for (const id of ids) {
      const notification = context.state.notifications.get(id);
      expect(notification.dispatch_status).toBe(DispatchStatus.SENT);
      expect(notification.provider_message_id).toBe('provider-1');
    }
  });

  test('respeta el límite del lote', async () => {
    const context = createTestContext();
    await prepareIncident(context);
    const result = await context.useCases.dispatchPendingNotifications({ limit: 1 });
    expect(result.claimed).toBe(1);
    expect(result.sent).toBe(1);
  });

  test('marca FAILED si no hay destinatario configurado', async () => {
    const context = createTestContext({
      recipients: {
        FLEET_ADMINISTRATOR: 'admin@example.com',
        MAINTENANCE_TECHNICIAN: null,
        MANAGEMENT: 'gerencia@example.com',
      },
    });
    const ids = await prepareIncident(context);
    const result = await context.useCases.dispatchPendingNotifications({ limit: 10 });
    expect(result).toMatchObject({ claimed: 2, sent: 1, failed: 1 });
    const failed = ids
      .map((id) => context.state.notifications.get(id))
      .find((notification) => notification.dispatch_status === DispatchStatus.FAILED);
    expect(failed.failure_reason).toBe('RECIPIENT_NOT_CONFIGURED');
  });

  test('reprograma fallos transitorios con backoff', async () => {
    const context = createTestContext();
    context.emailSender.send.mockRejectedValue(
      new EmailDeliveryError('timeout', { transient: true }),
    );
    await prepareIncident(context);
    const result = await context.useCases.dispatchPendingNotifications({ limit: 10 });
    expect(result).toMatchObject({ claimed: 2, sent: 0, retried: 2 });
    for (const notification of context.state.notifications.values()) {
      expect(notification.dispatch_status).toBe(DispatchStatus.PENDING_DISPATCH);
      expect(notification.dispatch_attempts).toBe(1);
      expect(notification.next_attempt_at).toEqual(new Date(FIXED_NOW.getTime() + 30000));
      expect(notification.locked_until).toBeNull();
    }
  });

  test('marca FAILED de inmediato ante un error permanente', async () => {
    const context = createTestContext();
    context.emailSender.send.mockRejectedValue(
      new EmailDeliveryError('invalid', { transient: false, code: 'INVALID_FROM' }),
    );
    await prepareIncident(context);
    const result = await context.useCases.dispatchPendingNotifications({ limit: 10 });
    expect(result).toMatchObject({ claimed: 2, sent: 0, failed: 2, retried: 0 });
    for (const notification of context.state.notifications.values()) {
      expect(notification.dispatch_status).toBe(DispatchStatus.FAILED);
      expect(notification.failure_reason).toBe('INVALID_FROM');
    }
  });

  test('marca FAILED al agotar el último intento', async () => {
    const context = createTestContext();
    const ids = await prepareIncident(context);
    for (const id of ids) {
      const current = context.state.notifications.get(id);
      context.state.notifications.set(id, new Notification({ ...current, dispatch_attempts: 3 }));
    }
    context.emailSender.send.mockRejectedValue(
      new EmailDeliveryError('timeout', { transient: true }),
    );
    const result = await context.useCases.dispatchPendingNotifications({ limit: 10 });
    expect(result).toMatchObject({ claimed: 2, failed: 2, retried: 0 });
    for (const id of ids) {
      expect(context.state.notifications.get(id).dispatch_attempts).toBe(4);
      expect(context.state.notifications.get(id).dispatch_status).toBe(DispatchStatus.FAILED);
    }
  });

  test('libera la reserva si el Circuit Breaker está abierto', async () => {
    const context = createTestContext();
    const error = new Error('open');
    error.code = 'EOPENBREAKER';
    context.emailSender.send.mockRejectedValue(error);
    await prepareIncident(context);
    const result = await context.useCases.dispatchPendingNotifications({ limit: 10 });
    expect(result).toMatchObject({ claimed: 2, sent: 0, circuit_open: 2 });
    for (const notification of context.state.notifications.values()) {
      expect(notification.dispatch_status).toBe(DispatchStatus.PENDING_DISPATCH);
      expect(notification.dispatch_attempts).toBe(0);
      expect(notification.locked_until).toBeNull();
    }
  });

  test('omite una notificación que otro proceso ya reservó', async () => {
    const context = createTestContext();
    const ids = await prepareIncident(context);
    const lockedId = ids[0];
    const current = context.state.notifications.get(lockedId);
    context.state.notifications.set(
      lockedId,
      new Notification({
        ...current,
        locked_until: new Date(FIXED_NOW.getTime() + 60000),
      }),
    );
    const result = await context.useCases.dispatchPendingNotifications({ limit: 10 });
    expect(result).toMatchObject({ claimed: 1, skipped: 1, sent: 1 });
  });

  test('no procesa nada si no hay pendientes vencidas', async () => {
    const context = createTestContext();
    const result = await context.useCases.dispatchPendingNotifications();
    expect(result).toMatchObject({ claimed: 0, sent: 0, skipped: 0 });
  });
});
