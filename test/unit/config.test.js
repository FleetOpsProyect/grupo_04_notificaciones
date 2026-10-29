const { loadConfig } = require('../../src/config/env.schema');
const { parseEventEnvelope } = require('../../src/adapters/in/shared/event-envelope');

describe('configuración', () => {
  test('aplica valores por defecto y normaliza listas', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.email.provider).toBe('console');
    expect(config.email.retryDelaysMs).toEqual([30000, 120000, 600000]);
    expect(config.sqs.consumerRetryDelaysMs).toEqual([2000, 10000, 30000]);
    expect(config.sqs.maxReceiveCount).toBe(4);
    expect(config.sqs.queueUrl).toBeNull();
    expect(config.recipients.MANAGEMENT).toBe('gerencia@example.invalid');
  });

  test('exige API key de Resend', () => {
    expect(() => loadConfig({ EMAIL_PROVIDER: 'resend' })).toThrow(
      'Configuración de entorno inválida',
    );
    const config = loadConfig({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' });
    expect(config.email.apiKey).toBe('re_test');
  });

  test('rechaza retardos inválidos', () => {
    expect(() => loadConfig({ EMAIL_RETRY_DELAYS_MS: 'abc' })).toThrow(
      'EMAIL_RETRY_DELAYS_MS contiene valores inválidos',
    );
    expect(() => loadConfig({ CONSUMER_RETRY_DELAYS_MS: '-1' })).toThrow(
      'CONSUMER_RETRY_DELAYS_MS contiene valores inválidos',
    );
  });
});

describe('sobre de evento estándar', () => {
  const validEnvelope = {
    event_id: '11111111-1111-4111-8111-111111111111',
    event_type: 'severe_incident_reported_event',
    version: 1,
    occurred_at: '2026-10-22T14:55:00.000Z',
    source: 'incident-service',
    correlation_id: '22222222-2222-4222-8222-222222222222',
    data: { incidente_id: 'INC-1' },
    desconocido: 'ignorado',
  };

  test('parsea un sobre válido y genera correlation_id si falta', () => {
    const envelope = parseEventEnvelope(Buffer.from(JSON.stringify(validEnvelope)));
    expect(envelope.event_type).toBe('severe_incident_reported_event');
    expect(envelope.desconocido).toBeUndefined();
    const withoutCorrelation = parseEventEnvelope(
      Buffer.from(JSON.stringify({ ...validEnvelope, correlation_id: undefined })),
    );
    expect(withoutCorrelation.correlation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test('rechaza JSON inválido, UUID inválido y datos ausentes', () => {
    expect(() => parseEventEnvelope(Buffer.from('{'))).toThrow('JSON válido');
    expect(() =>
      parseEventEnvelope(Buffer.from(JSON.stringify({ ...validEnvelope, event_id: 'no-uuid' }))),
    ).toThrow('Sobre de evento inválido');
    expect(() =>
      parseEventEnvelope(Buffer.from(JSON.stringify({ ...validEnvelope, data: null }))),
    ).toThrow('Sobre de evento inválido');
    expect(() =>
      parseEventEnvelope(Buffer.from(JSON.stringify({ ...validEnvelope, version: '2' }))),
    ).not.toThrow();
  });

  test('rechaza event_type del atributo distinto al del sobre', () => {
    expect(() =>
      parseEventEnvelope(Buffer.from(JSON.stringify(validEnvelope)), {
        attributeEventType: 'minor_incident_reported_event',
      }),
    ).toThrow('no coincide');
  });
});
