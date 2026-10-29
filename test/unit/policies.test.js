const {
  decideFailure,
  isDispatchDue,
  DEFAULT_RETRY_DELAYS_MS,
} = require('../../src/domain/policies/dispatch.policy');
const {
  nextAcknowledgementStatus,
  shouldPreserveAcknowledgedAt,
} = require('../../src/domain/policies/attention.policy');
const {
  normalizeRecipientEmail,
  isValidRecipientEmail,
} = require('../../src/domain/value-objects/recipient-email');
const {
  AcknowledgementStatus,
  DeliveryStatus,
  Origin,
  RecipientRole,
  Severity,
  Type,
} = require('../../src/domain/enums');
const { Notification } = require('../../src/domain/entities/notification');

const NOW = new Date('2026-10-22T15:00:00.000Z');

describe('dispatch policy', () => {
  test('calcula reintentos y el intento final', () => {
    expect(decideFailure({ deliveryAttempts: 0 })).toEqual({
      attempts: 1,
      final: false,
      delayMs: DEFAULT_RETRY_DELAYS_MS[0],
    });
    expect(decideFailure({ deliveryAttempts: 2 })).toEqual({
      attempts: 3,
      final: false,
      delayMs: DEFAULT_RETRY_DELAYS_MS[2],
    });
    expect(decideFailure({ deliveryAttempts: 3 })).toEqual({
      attempts: 4,
      final: true,
      delayMs: null,
    });
    expect(decideFailure({ deliveryAttempts: 0, retryDelaysMs: [10], maxAttempts: 5 })).toEqual({
      attempts: 1,
      final: false,
      delayMs: 10,
    });
    expect(decideFailure({ deliveryAttempts: 1, retryDelaysMs: [10], maxAttempts: 5 })).toEqual({
      attempts: 2,
      final: true,
      delayMs: null,
    });
  });

  test('determina si una notificación puede despacharse', () => {
    const base = new Notification({
      notification_id: 'n-1',
      alert_id: 'a-1',
      type: Type.GENERAL,
      severity: Severity.INFO,
      recipient_role: RecipientRole.MANAGEMENT,
      subject: 'Asunto',
      message: 'Mensaje',
      origin: Origin.MANUAL,
      correlation_id: 'c-1',
      next_attempt_at: NOW,
      created_at: NOW,
    });
    expect(isDispatchDue(base, NOW)).toBe(true);
    expect(
      isDispatchDue(
        new Notification({
          ...base,
          delivery_status: DeliveryStatus.SENT,
          sent_at: NOW,
        }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isDispatchDue(
        new Notification({ ...base, next_attempt_at: new Date('2026-10-22T16:00:00Z') }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isDispatchDue(
        new Notification({ ...base, locked_until: new Date('2026-10-22T15:30:00Z') }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isDispatchDue(
        new Notification({ ...base, locked_until: new Date('2026-10-22T14:30:00Z') }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe('attention policy', () => {
  test('mantiene el reconocimiento idempotente', () => {
    expect(nextAcknowledgementStatus(AcknowledgementStatus.PENDING)).toBe(
      AcknowledgementStatus.ACKNOWLEDGED,
    );
    expect(nextAcknowledgementStatus(AcknowledgementStatus.ACKNOWLEDGED)).toBe(
      AcknowledgementStatus.ACKNOWLEDGED,
    );
    expect(shouldPreserveAcknowledgedAt(AcknowledgementStatus.ACKNOWLEDGED)).toBe(true);
    expect(shouldPreserveAcknowledgedAt(AcknowledgementStatus.PENDING)).toBe(false);
  });
});

describe('recipient email value object', () => {
  test('normaliza correos válidos', () => {
    expect(normalizeRecipientEmail('  USER@Example.COM ')).toBe('user@example.com');
    expect(isValidRecipientEmail('a@b.co')).toBe(true);
  });

  test.each([null, 42, '', 'sin-arroba', 'a@b', 'a b@c.co', `${'a'.repeat(250)}@b.co`])(
    'rechaza correo inválido %p',
    (value) => {
      expect(isValidRecipientEmail(value)).toBe(false);
      expect(() => normalizeRecipientEmail(value)).toThrow();
    },
  );
});
