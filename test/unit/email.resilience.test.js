const {
  createResilientEmailSender,
} = require('../../src/adapters/out/email/resilient-email-sender.decorator');
const { createConsoleEmailSender } = require('../../src/adapters/out/email/console-email-sender');
const { EmailDeliveryError } = require('../../src/domain/errors');
const { DeliveryStatus } = require('../../src/domain/enums');
const {
  createTestContext,
  createSilentLogger,
  eventEnvelope,
  FIXED_NOW,
} = require('../helpers/test-context');

const message = {
  to: 'destinatario@example.com',
  subject: 'Asunto de prueba',
  text: 'Cuerpo del correo',
  notificationId: 'notif-1',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForState = async (sender, expected) => {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (sender.getState() === expected) {
      return;
    }
    await sleep(10);
  }
  expect(sender.getState()).toBe(expected);
};

const createSender = ({ send, threshold = 5, resetMs = 30000, timeoutMs = 100, metrics, logger }) =>
  createResilientEmailSender({
    sender: { send },
    timeoutMs,
    circuitBreakerThreshold: threshold,
    circuitBreakerResetMs: resetMs,
    metrics,
    logger,
  });

describe('Email sender resiliente', () => {
  test('envía con el Circuit Breaker cerrado', async () => {
    const send = jest.fn().mockResolvedValue({ provider_message_id: 'provider-1' });
    const sender = createSender({ send });

    await expect(sender.send(message)).resolves.toEqual({
      provider_message_id: 'provider-1',
    });
    expect(sender.getState()).toBe('closed');
    sender.breaker.shutdown();
  });

  test('abre el Circuit Breaker tras errores transitorios y deja de llamar al proveedor', async () => {
    const send = jest.fn().mockRejectedValue(new Error('network'));
    const sender = createSender({ send, threshold: 2, resetMs: 1000 });

    await expect(sender.send(message)).rejects.toMatchObject({
      transient: true,
      code: 'EMAIL_DELIVERY_ERROR',
    });
    await expect(sender.send(message)).rejects.toMatchObject({
      transient: true,
      code: 'EMAIL_DELIVERY_ERROR',
    });
    expect(sender.getState()).toBe('open');

    await expect(sender.send(message)).rejects.toMatchObject({
      name: 'CircuitBreakerOpenError',
      code: 'EOPENBREAKER',
    });
    expect(send).toHaveBeenCalledTimes(2);
    sender.breaker.shutdown();
  });

  test('pasa por half-open y cierra el Circuit Breaker con un envío exitoso', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ provider_message_id: 'provider-2' });
    const sender = createSender({ send, threshold: 1, resetMs: 20 });

    await expect(sender.send(message)).rejects.toMatchObject({
      code: 'EMAIL_DELIVERY_ERROR',
    });
    expect(sender.getState()).toBe('open');

    await waitForState(sender, 'halfOpen');

    await expect(sender.send(message)).resolves.toEqual({
      provider_message_id: 'provider-2',
    });
    expect(sender.getState()).toBe('closed');
    sender.breaker.shutdown();
  });

  test('mapea el timeout del Circuit Breaker como error transitorio', async () => {
    const send = jest.fn(() => new Promise(() => {}));
    const sender = createSender({ send, timeoutMs: 10, threshold: 10 });

    await expect(sender.send(message)).rejects.toMatchObject({
      transient: true,
      code: 'EMAIL_TIMEOUT',
    });
    sender.breaker.shutdown();
  });

  test('los errores permanentes no abren el Circuit Breaker', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(
        new EmailDeliveryError('from inválido', { transient: false, code: 'INVALID_FROM' }),
      );
    const sender = createSender({ send, threshold: 1 });

    await expect(sender.send(message)).rejects.toMatchObject({
      transient: false,
      code: 'INVALID_FROM',
    });
    await expect(sender.send(message)).rejects.toMatchObject({
      transient: false,
      code: 'INVALID_FROM',
    });
    expect(sender.getState()).toBe('closed');
    expect(send).toHaveBeenCalledTimes(2);
    sender.breaker.shutdown();
  });

  test('un Circuit Breaker abierto libera la reserva y mantiene PENDING', async () => {
    const send = jest.fn().mockRejectedValue(new Error('network'));
    const sender = createSender({ send, threshold: 1, resetMs: 1000 });
    const context = createTestContext({ emailSender: sender });

    await context.useCases.processDomainEvent(eventEnvelope());
    const result = await context.useCases.dispatchPendingNotifications({ limit: 10 });

    expect(result).toEqual({
      claimed: 2,
      sent: 0,
      failed: 0,
      retried: 1,
      skipped: 0,
      circuit_open: 1,
    });
    const notifications = [...context.state.notifications.values()];
    expect(
      notifications.every(
        (notification) => notification.delivery_status === DeliveryStatus.PENDING,
      ),
    ).toBe(true);
    expect(notifications.every((notification) => notification.locked_until === null)).toBe(true);

    const retried = notifications.find((notification) => notification.delivery_attempts === 1);
    expect(retried.next_attempt_at).toEqual(new Date(FIXED_NOW.getTime() + 30000));
    const released = notifications.find((notification) => notification.delivery_attempts === 0);
    expect(released).toBeDefined();
    sender.breaker.shutdown();
  });

  test('el log del despacho no incluye el correo completo ni el cuerpo', async () => {
    const logger = createSilentLogger();
    const context = createTestContext({
      emailSender: {
        send: jest
          .fn()
          .mockRejectedValue(new EmailDeliveryError('fallo de prueba', { transient: true })),
      },
      logger,
    });

    await context.useCases.processDomainEvent(eventEnvelope());
    await context.useCases.dispatchPendingNotifications({ limit: 10 });

    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(logged).not.toContain('admin@example.com');
    expect(logged).not.toContain('tecnico@example.com');
    expect(logged).not.toContain('gerencia@example.com');
    expect(logged).not.toContain('REQUIERE ASISTENCIA INMEDIATA');
  });

  test('el proveedor de consola enmascara el destinatario y no registra el cuerpo', async () => {
    const logger = { info: jest.fn() };
    const sender = createConsoleEmailSender({ logger });

    await sender.send({
      to: 'persona@example.com',
      subject: 'Asunto',
      text: 'Cuerpo secreto',
      notificationId: 'notif-1',
    });

    expect(logger.info).toHaveBeenCalledWith(
      {
        notification_id: 'notif-1',
        recipient: 'p***@example.com',
        subject: 'Asunto',
        provider: 'console',
      },
      'Correo simulado en consola',
    );
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain('persona@example.com');
    expect(logged).not.toContain('Cuerpo secreto');
  });
});
