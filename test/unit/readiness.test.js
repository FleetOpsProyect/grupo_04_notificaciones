const { createReadiness } = require('../../src/observability/readiness');

describe('Readiness', () => {
  test('responde READY cuando Firestore y broker están disponibles', async () => {
    const check = createReadiness({
      databaseCheck: jest.fn().mockResolvedValue(),
      brokerCheck: jest.fn().mockResolvedValue(),
      emailProviderName: 'console',
      timeoutMs: 100,
    });

    const result = await check();

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      status: 'READY',
      checks: {
        database: { status: 'UP' },
        broker: { status: 'UP' },
        email_provider: { status: 'UP', provider: 'console' },
      },
    });
  });

  test('responde NOT_READY con Firestore caído y broker arriba', async () => {
    const check = createReadiness({
      databaseCheck: jest.fn().mockRejectedValue(new Error('firestore caído')),
      brokerCheck: jest.fn().mockResolvedValue(),
      timeoutMs: 100,
    });

    const result = await check();

    expect(result.statusCode).toBe(503);
    expect(result.body.status).toBe('NOT_READY');
    expect(result.body.checks.database.status).toBe('DOWN');
    expect(result.body.checks.broker.status).toBe('UP');
  });

  test('responde NOT_READY con Firestore y broker caídos', async () => {
    const check = createReadiness({
      databaseCheck: jest.fn().mockRejectedValue(new Error('firestore caído')),
      brokerCheck: jest.fn().mockRejectedValue(new Error('broker caído')),
      timeoutMs: 100,
    });

    const result = await check();

    expect(result.statusCode).toBe(503);
    expect(result.body.checks.database.status).toBe('DOWN');
    expect(result.body.checks.broker.status).toBe('DOWN');
  });

  test('marca el broker como DISABLED cuando el broker está deshabilitado', async () => {
    const check = createReadiness({
      databaseCheck: jest.fn().mockResolvedValue(),
      brokerCheck: null,
      timeoutMs: 100,
    });

    const result = await check();

    expect(result.statusCode).toBe(200);
    expect(result.body.checks.broker).toEqual({ status: 'DISABLED' });
  });

  test('no bloquea readiness por broker caído si Firestore responde', async () => {
    const check = createReadiness({
      databaseCheck: jest.fn().mockResolvedValue(),
      brokerCheck: jest.fn().mockRejectedValue(new Error('broker caído')),
      timeoutMs: 100,
    });

    const result = await check();

    expect(result.statusCode).toBe(200);
    expect(result.body.status).toBe('READY');
    expect(result.body.checks.broker.status).toBe('DOWN');
  });

  test('aplica timeout a los chequeos lentos', async () => {
    const check = createReadiness({
      databaseCheck: () => new Promise(() => {}),
      brokerCheck: () => new Promise(() => {}),
      timeoutMs: 5,
    });

    const result = await check();

    expect(result.statusCode).toBe(503);
    expect(result.body.checks.database.status).toBe('DOWN');
    expect(result.body.checks.broker.status).toBe('DOWN');
  });
});
