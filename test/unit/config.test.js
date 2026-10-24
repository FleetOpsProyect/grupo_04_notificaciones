const { loadConfig } = require('../../src/config/env.schema');
const { parseEventEnvelope } = require('../../src/adapters/in/kafka/event-envelope');

describe('configuración', () => {
  test('aplica valores por defecto y normaliza listas', () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.email.provider).toBe('console');
    expect(config.email.retryDelaysMs).toEqual([30000, 120000, 600000]);
    expect(config.kafka.brokers).toEqual(['127.0.0.1:9092']);
    expect(config.kafka.enabled).toBe(false);
    expect(config.recipients.MANAGEMENT).toBe('gerencia@example.invalid');
  });

  test('exige API key de Resend y credenciales SASL', () => {
    expect(() => loadConfig({ EMAIL_PROVIDER: 'resend' })).toThrow(
      'Configuración de entorno inválida',
    );
    expect(() =>
      loadConfig({ KAFKA_SASL_MECHANISM: 'plain', KAFKA_SASL_USERNAME: 'user' }),
    ).toThrow('Configuración de entorno inválida');
    const config = loadConfig({
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_test',
      KAFKA_SASL_MECHANISM: 'plain',
      KAFKA_SASL_USERNAME: 'user',
      KAFKA_SASL_PASSWORD: 'secret',
      KAFKA_ENABLED: 'true',
      KAFKA_BROKERS: 'broker1:9092, broker2:9092',
    });
    expect(config.email.apiKey).toBe('re_test');
    expect(config.kafka.sasl).toEqual({
      mechanism: 'plain',
      username: 'user',
      password: 'secret',
    });
    expect(config.kafka.brokers).toEqual(['broker1:9092', 'broker2:9092']);
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

describe('sobre de evento Kafka', () => {
  const validEnvelope = {
    evento_id: '11111111-1111-4111-8111-111111111111',
    tipo_evento: 'IncidenteReportadoEvent',
    version: 1,
    fecha_evento: '2026-10-22T14:55:00.000Z',
    origen: 'incident-service',
    correlation_id: '22222222-2222-4222-8222-222222222222',
    datos: { incidente_id: 'INC-1' },
    desconocido: 'ignorado',
  };

  test('parsea un sobre válido y genera correlation_id si falta', () => {
    const envelope = parseEventEnvelope(Buffer.from(JSON.stringify(validEnvelope)));
    expect(envelope.tipo_evento).toBe('IncidenteReportadoEvent');
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
      parseEventEnvelope(Buffer.from(JSON.stringify({ ...validEnvelope, evento_id: 'no-uuid' }))),
    ).toThrow('Sobre de evento inválido');
    expect(() =>
      parseEventEnvelope(Buffer.from(JSON.stringify({ ...validEnvelope, datos: null }))),
    ).toThrow('Sobre de evento inválido');
    expect(() =>
      parseEventEnvelope(Buffer.from(JSON.stringify({ ...validEnvelope, version: '2' }))),
    ).toThrow('Sobre de evento inválido');
  });
});
