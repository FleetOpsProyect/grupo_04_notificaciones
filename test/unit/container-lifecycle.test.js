const request = require('supertest');
const { config: baseConfig } = require('../../src/config/env');

const mockChain = {
  where: jest.fn(() => mockChain),
  orderBy: jest.fn(() => mockChain),
  limit: jest.fn(() => mockChain),
  offset: jest.fn(() => mockChain),
  get: jest.fn().mockResolvedValue({ docs: [] }),
  count: jest.fn(() => ({
    get: jest.fn().mockResolvedValue({ data: () => ({ count: 0 }) }),
  })),
  doc: jest.fn(() => mockChain),
  set: jest.fn().mockResolvedValue(),
  update: jest.fn().mockResolvedValue(),
  delete: jest.fn().mockResolvedValue(),
};

const mockFirestore = {
  db: {
    collection: jest.fn(() => mockChain),
    runTransaction: jest.fn(),
  },
  databaseCheck: jest.fn().mockResolvedValue(),
  close: jest.fn().mockResolvedValue(),
};

jest.mock('../../src/adapters/out/firestore/firestore.client', () => ({
  createFirestoreClient: jest.fn(() => mockFirestore),
}));
jest.mock('../../src/adapters/out/kafka/kafka.client', () => ({
  createKafkaClient: jest.fn(),
}));

const { createContainer } = require('../../src/config/composition-root');
const { createFirestoreClient } = require('../../src/adapters/out/firestore/firestore.client');
const { createKafkaClient } = require('../../src/adapters/out/kafka/kafka.client');

const buildConfig = (overrides = {}) => ({
  ...baseConfig,
  logLevel: 'silent',
  kafka: { ...baseConfig.kafka, enabled: false },
  dispatch: { ...baseConfig.dispatch, intervalMs: 60000 },
  enableSwagger: false,
  ...overrides,
});

describe('Ciclo de vida del contenedor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFirestore.databaseCheck.mockResolvedValue();
    mockFirestore.close.mockResolvedValue();
    mockChain.get.mockResolvedValue({ docs: [] });
  });

  test('arranca con Kafka deshabilitado, responde readiness y cierra recursos', async () => {
    const container = createContainer(buildConfig());

    await container.start();
    await new Promise((resolve) => setImmediate(resolve));

    expect(createKafkaClient).not.toHaveBeenCalled();

    const ready = await request(container.app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('READY');
    expect(ready.body.checks.database.status).toBe('UP');
    expect(ready.body.checks.broker).toEqual({ status: 'DISABLED' });

    await container.stop();

    expect(mockFirestore.close).toHaveBeenCalledTimes(1);
  });

  test('arranca aunque Firestore no responda y reporta NOT_READY', async () => {
    mockFirestore.databaseCheck.mockRejectedValue(new Error('firestore caído'));
    const container = createContainer(buildConfig());

    await expect(container.start()).resolves.toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));

    const ready = await request(container.app).get('/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.status).toBe('NOT_READY');
    expect(ready.body.checks.database.status).toBe('DOWN');
    expect(ready.body.checks.broker).toEqual({ status: 'DISABLED' });

    await container.stop();
  });

  test('no arranca dos veces y el cierre es idempotente', async () => {
    const container = createContainer(buildConfig());

    await container.start();
    await container.start();
    await container.stop();
    await container.stop();

    expect(createFirestoreClient).toHaveBeenCalledTimes(1);
    expect(mockFirestore.close).toHaveBeenCalledTimes(1);
  });
});
