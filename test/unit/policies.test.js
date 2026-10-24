const {
  decideFailure,
  isDispatchDue,
  DEFAULT_RETRY_DELAYS_MS,
} = require('../../src/domain/policies/dispatch.policy');
const {
  nextAttentionStatus,
  shouldPreserveAttendedAt,
} = require('../../src/domain/policies/attention.policy');
const {
  normalizeRecipientEmail,
  isValidRecipientEmail,
} = require('../../src/domain/value-objects/recipient-email');
const {
  AttentionStatus,
  DispatchStatus,
  Origin,
  RecipientRole,
  Severity,
  Type,
} = require('../../src/domain/enums');
const { Notification } = require('../../src/domain/entities/notification');

const NOW = new Date('2026-10-22T15:00:00.000Z');

describe('dispatch policy', () => {
  test('calcula reintentos y el intento final', () => {
    expect(decideFailure({ dispatchAttempts: 0 })).toEqual({
      attempts: 1,
      final: false,
      delayMs: DEFAULT_RETRY_DELAYS_MS[0],
    });
    expect(decideFailure({ dispatchAttempts: 2 })).toEqual({
      attempts: 3,
      final: false,
      delayMs: DEFAULT_RETRY_DELAYS_MS[2],
    });
    expect(decideFailure({ dispatchAttempts: 3 })).toEqual({
      attempts: 4,
      final: true,
      delayMs: null,
    });
    expect(decideFailure({ dispatchAttempts: 0, retryDelaysMs: [10], maxAttempts: 5 })).toEqual({
      attempts: 1,
      final: false,
      delayMs: 10,
    });
    expect(decideFailure({ dispatchAttempts: 1, retryDelaysMs: [10], maxAttempts: 5 })).toEqual({
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
      severity: Severity.INFORMATIONAL,
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
          dispatch_status: DispatchStatus.SENT,
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
  test('mantiene la atención idempotente', () => {
    expect(nextAttentionStatus(AttentionStatus.PENDING)).toBe(AttentionStatus.ATTENDED);
    expect(nextAttentionStatus(AttentionStatus.ATTENDED)).toBe(AttentionStatus.ATTENDED);
    expect(shouldPreserveAttendedAt(AttentionStatus.ATTENDED)).toBe(true);
    expect(shouldPreserveAttendedAt(AttentionStatus.PENDING)).toBe(false);
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
