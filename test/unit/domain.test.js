const { Alert } = require('../../src/domain/entities/alert');
const { Notification } = require('../../src/domain/entities/notification');
const {
  AcknowledgementStatus,
  DeliveryStatus,
  Origin,
  RecipientRole,
  Severity,
  Type,
} = require('../../src/domain/enums');
const { InvalidDataError, InvalidStateTransitionError } = require('../../src/domain/errors');

const NOW = new Date('2026-10-22T15:00:00.000Z');

const baseAlert = (overrides = {}) =>
  new Alert({
    alert_id: 'alert-1',
    origin: Origin.EVENT,
    type: Type.INCIDENT,
    severity: Severity.CRITICAL,
    correlation_id: 'corr-1',
    created_at: NOW,
    ...overrides,
  });

const baseNotification = (overrides = {}) =>
  new Notification({
    notification_id: 'notification-1',
    alert_id: 'alert-1',
    type: Type.INCIDENT,
    severity: Severity.CRITICAL,
    recipient_role: RecipientRole.FLEET_ADMINISTRATOR,
    subject: 'Asunto',
    message: 'Mensaje',
    origin: Origin.EVENT,
    correlation_id: 'corr-1',
    next_attempt_at: NOW,
    created_at: NOW,
    ...overrides,
  });

describe('Alert', () => {
  test('crea una alerta válida y detecta críticas pendientes', () => {
    const alert = baseAlert();
    expect(alert.isCriticalPending()).toBe(true);
    expect(alert.acknowledgement_status).toBe(AcknowledgementStatus.PENDING);
  });

  test('marca como reconocida de forma idempotente', () => {
    const alert = baseAlert();
    const attended = alert.acknowledge(NOW);
    expect(attended.acknowledgement_status).toBe(AcknowledgementStatus.ACKNOWLEDGED);
    expect(attended.acknowledged_at).toBe(NOW);
    expect(attended.acknowledge(new Date('2026-10-23T00:00:00Z'))).toBe(attended);
    expect(attended.isCriticalPending()).toBe(false);
  });

  test.each([
    [{ alert_id: '' }, 'alert_id'],
    [{ origin: 'OTRO' }, 'origin'],
    [{ type: 'OTRO' }, 'type'],
    [{ severity: 'OTRO' }, 'severity'],
    [{ acknowledgement_status: 'OTRO' }, 'acknowledgement_status'],
    [{ created_at: 'no-date' }, 'created_at'],
    [{ acknowledged_at: 'no-date' }, 'acknowledged_at'],
    [
      { acknowledgement_status: AcknowledgementStatus.ACKNOWLEDGED, acknowledged_at: null },
      'acknowledged_at es obligatorio',
    ],
  ])('rechaza datos inválidos %#', (overrides, message) => {
    expect(() => baseAlert(overrides)).toThrow(message);
  });

  test('rechaza una fecha inválida al atender', () => {
    expect(() => baseAlert().acknowledge('ayer')).toThrow(InvalidDataError);
  });
});

describe('Notification', () => {
  test('crea una notificación pendiente por defecto', () => {
    const notification = baseNotification();
    expect(notification.delivery_status).toBe(DeliveryStatus.PENDING);
    expect(notification.acknowledgement_status).toBe(AcknowledgementStatus.PENDING);
    expect(notification.delivery_attempts).toBe(0);
    expect(notification.isFinal()).toBe(false);
  });

  test('reclama una notificación disponible y libera la reserva', () => {
    const claimed = baseNotification().claim(NOW, 60000);
    expect(claimed.locked_until).toEqual(new Date('2026-10-22T15:01:00.000Z'));
    expect(claimed.releaseClaim().locked_until).toBeNull();
  });

  test('no reclama si no está pendiente, aún no vence o está bloqueada', () => {
    expect(
      baseNotification({
        delivery_status: DeliveryStatus.SENT,
        sent_at: NOW,
      }).claim(NOW, 60000),
    ).toBeNull();
    expect(
      baseNotification({ next_attempt_at: new Date('2026-10-22T16:00:00Z') }).claim(NOW, 60000),
    ).toBeNull();
    expect(
      baseNotification({ locked_until: new Date('2026-10-22T15:30:00Z') }).claim(NOW, 60000),
    ).toBeNull();
    expect(
      baseNotification({ locked_until: new Date('2026-10-22T14:30:00Z') }).claim(NOW, 60000),
    ).not.toBeNull();
  });

  test('marca SENT y es idempotente', () => {
    const sent = baseNotification().markSent(NOW, 'provider-1');
    expect(sent.delivery_status).toBe(DeliveryStatus.SENT);
    expect(sent.sent_at).toBe(NOW);
    expect(sent.next_attempt_at).toBeNull();
    expect(sent.failure_reason).toBeNull();
    expect(sent.isFinal()).toBe(true);
    expect(sent.markSent(new Date(), 'provider-2')).toBe(sent);
  });

  test('rechaza SENT inválido o desde FAILED', () => {
    expect(() => baseNotification().markSent('ayer', 'provider')).toThrow(InvalidDataError);
    expect(() => baseNotification().markSent(NOW, null)).toThrow(InvalidDataError);
    expect(() =>
      baseNotification({ delivery_status: DeliveryStatus.FAILED }).markSent(NOW, 'provider'),
    ).toThrow(InvalidStateTransitionError);
  });

  test('marca FAILED y evita fallar una SENT', () => {
    const failed = baseNotification().markFailed(NOW, 'ERROR');
    expect(failed.delivery_status).toBe(DeliveryStatus.FAILED);
    expect(failed.delivery_attempts).toBe(1);
    expect(failed.next_attempt_at).toBeNull();
    expect(failed.markFailed(NOW, 'OTRO')).toBe(failed);
    expect(() => baseNotification().markFailed(NOW, '')).toThrow(InvalidDataError);
    expect(() => baseNotification().markFailed('ayer', 'ERROR')).toThrow(InvalidDataError);
    expect(() =>
      baseNotification({ delivery_status: DeliveryStatus.SENT, sent_at: NOW }).markFailed(
        NOW,
        'ERROR',
      ),
    ).toThrow(InvalidStateTransitionError);
  });

  test('programa un reintento solo desde PENDING', () => {
    const retry = baseNotification().scheduleRetry(new Date('2026-10-22T15:30:00Z'), 'TIMEOUT', 2);
    expect(retry.delivery_attempts).toBe(2);
    expect(retry.locked_until).toBeNull();
    expect(retry.delivery_status).toBe(DeliveryStatus.PENDING);
    expect(() => baseNotification().scheduleRetry('ayer', 'TIMEOUT')).toThrow(InvalidDataError);
    expect(() => baseNotification().scheduleRetry(NOW, '')).toThrow(InvalidDataError);
    expect(() =>
      baseNotification({
        delivery_status: DeliveryStatus.SENT,
        sent_at: NOW,
      }).scheduleRetry(NOW, 'TIMEOUT'),
    ).toThrow(InvalidStateTransitionError);
  });

  test('marca el reconocimiento sin tocar el despacho', () => {
    const attended = baseNotification().acknowledge(NOW);
    expect(attended.acknowledgement_status).toBe(AcknowledgementStatus.ACKNOWLEDGED);
    expect(attended.delivery_status).toBe(DeliveryStatus.PENDING);
    expect(attended.acknowledge(new Date())).toBe(attended);
    expect(() => baseNotification().acknowledge('ayer')).toThrow(InvalidDataError);
  });

  test.each([
    [{ notification_id: '' }, 'notification_id'],
    [{ alert_id: '' }, 'alert_id'],
    [{ subject: '' }, 'subject'],
    [{ message: '' }, 'message'],
    [{ type: 'OTRO' }, 'type'],
    [{ severity: 'OTRO' }, 'severity'],
    [{ origin: 'OTRO' }, 'origin'],
    [{ recipient_role: 'OTRO' }, 'recipient_role'],
    [{ acknowledgement_status: 'OTRO' }, 'acknowledgement_status'],
    [{ delivery_status: 'OTRO' }, 'delivery_status'],
    [{ created_at: 'ayer' }, 'created_at'],
    [{ next_attempt_at: 'ayer' }, 'next_attempt_at'],
    [{ locked_until: 'ayer' }, 'locked_until'],
    [{ acknowledged_at: 'ayer' }, 'acknowledged_at'],
    [{ sent_at: 'ayer' }, 'sent_at'],
    [{ delivery_attempts: -1 }, 'delivery_attempts'],
    [
      { acknowledgement_status: AcknowledgementStatus.ACKNOWLEDGED, acknowledged_at: null },
      'acknowledged_at es obligatorio',
    ],
    [{ delivery_status: DeliveryStatus.SENT, sent_at: null }, 'sent_at es obligatorio'],
    [
      { delivery_status: DeliveryStatus.PENDING, next_attempt_at: null },
      'next_attempt_at es obligatorio',
    ],
  ])('rechaza datos inválidos %#', (overrides, message) => {
    expect(() => baseNotification(overrides)).toThrow(message);
  });
});
