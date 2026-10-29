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
const mockSqsClient = { send: jest.fn().mockResolvedValue({}), destroy: jest.fn() };
const mockSnsClient = { send: jest.fn().mockResolvedValue({}), destroy: jest.fn() };
const mockConsumer = { start: jest.fn().mockResolvedValue(), stop: jest.fn().mockResolvedValue() };

jest.mock('../../src/adapters/out/sqs/sqs.client', () => ({
  createSqsClient: jest.fn(() => mockSqsClient),
}));
jest.mock('../../src/adapters/out/sns/sns.client', () => ({
  createSnsClient: jest.fn(() => mockSnsClient),
}));
jest.mock('../../src/adapters/in/sqs/sqs-event.consumer', () => ({
  createSqsEventConsumer: jest.fn(() => mockConsumer),
}));

const { createContainer } = require('../../src/config/composition-root');
const { createFirestoreClient } = require('../../src/adapters/out/firestore/firestore.client');
const { createSqsClient } = require('../../src/adapters/out/sqs/sqs.client');
const { createSqsEventConsumer } = require('../../src/adapters/in/sqs/sqs-event.consumer');

const buildConfig = (overrides = {}) => ({
  ...baseConfig,
  logLevel: 'silent',
  sqs: { ...baseConfig.sqs, queueUrl: 'http://localhost/queue.fifo', dlqUrl: null },
  sns: { notificationTopicArn: null },
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

  test('arranca con SQS, responde readiness y cierra recursos', async () => {
    const container = createContainer(buildConfig());

    await container.start();
    await new Promise((resolve) => setImmediate(resolve));

    expect(createSqsClient).toHaveBeenCalled();
    expect(createSqsEventConsumer).toHaveBeenCalled();
    expect(mockConsumer.start).toHaveBeenCalled();

    const ready = await request(container.app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('READY');
    expect(ready.body.checks.database.status).toBe('UP');
    expect(ready.body.checks.broker).toEqual({ status: 'UP' });

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
    expect(ready.body.checks.broker).toEqual({ status: 'UP' });

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
    expect(mockConsumer.stop).toHaveBeenCalledTimes(1);
  });
});
