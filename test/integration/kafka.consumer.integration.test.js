const { randomUUID } = require('node:crypto');
const { createKafkaClient } = require('../../src/adapters/out/kafka/kafka.client');
const { createKafkaEventConsumer } = require('../../src/adapters/in/kafka/kafka-event.consumer');
const {
  createKafkaDeadLetterPublisher,
} = require('../../src/adapters/out/kafka/kafka-dead-letter.publisher');
const { InvalidDataError, ServiceUnavailableError } = require('../../src/domain/errors');
const {
  createSilentLogger,
  createTestContext,
  createTestMetrics,
  eventEnvelope,
} = require('../helpers/test-context');

jest.setTimeout(30000);

const RUN = process.env.KAFKA_INTEGRATION === 'true';
const describeKafka = RUN ? describe : describe.skip;
const brokers = (process.env.KAFKA_BROKERS ?? '127.0.0.1:9092')
  .split(',')
  .map((broker) => broker.trim())
  .filter(Boolean);

const kafka = createKafkaClient({
  clientId: `notification-integration-${process.pid}`,
  brokers,
  ssl: false,
  sasl: null,
});

const admin = kafka.admin();
const producer = kafka.producer();
const consumers = [];
const createdTopics = [];
let sequence = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const uniqueName = (prefix) => {
  sequence += 1;
  return `fleetops.it.${prefix}.${Date.now()}.${process.pid}.${sequence}`;
};

const makeEvent = (overrides = {}) =>
  eventEnvelope({
    evento_id: randomUUID(),
    ...overrides,
  });

const createTopic = async (prefix) => {
  const topic = uniqueName(prefix);
  createdTopics.push(topic);
  await admin.createTopics({
    topics: [{ topic, numPartitions: 1, replicationFactor: 1 }],
    waitForLeaders: true,
  });
  return topic;
};

const publish = (topic, value) =>
  producer.send({
    topic,
    messages: [
      {
        key: randomUUID(),
        value: typeof value === 'string' ? value : JSON.stringify(value),
      },
    ],
  });

const waitFor = async (predicate, label, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await sleep(50);
  }
  throw new Error(`Timeout esperando: ${label}`);
};

const committedOffset = async (groupId, topic) => {
  const result = await admin.fetchOffsets({ groupId, topics: [topic] });
  return result?.[0]?.partitions?.[0]?.offset ?? null;
};

const topicHighOffset = async (topic) => {
  const result = await admin.fetchTopicOffsets(topic);
  return Number(result?.[0]?.partitions?.[0]?.offset ?? 0);
};

const readMessages = async (topic, count, timeoutMs = 10000) => {
  const reader = kafka.consumer({ groupId: uniqueName('reader') });
  await reader.connect();
  await reader.subscribe({ topic, fromBeginning: true });

  const messages = [];
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  await reader.run({
    autoCommit: false,
    eachMessage: async ({ message }) => {
      messages.push(message);
      if (messages.length >= count) {
        resolveDone();
      }
    },
  });

  const timer = setTimeout(
    () => rejectDone(new Error(`Timeout leyendo ${count} mensaje(s) de ${topic}`)),
    timeoutMs,
  );

  try {
    await done;
    return messages;
  } finally {
    clearTimeout(timer);
    await reader.disconnect().catch(() => {});
  }
};

const startConsumer = async ({
  groupId,
  topic,
  processDomainEvent,
  deadLetterPublisher,
  retryDelaysMs = [20, 20, 20],
}) => {
  const consumer = createKafkaEventConsumer({
    kafka,
    kafkaConfig: {
      groupId,
      topics: { incident: topic },
      dlqTopic: 'unused',
      consumerRetryDelaysMs: retryDelaysMs,
      consumerHeartbeatMs: 1000,
    },
    processDomainEvent,
    deadLetterPublisher,
    logger: createSilentLogger(),
    metrics: createTestMetrics(),
  });
  consumers.push(consumer);
  await consumer.start();
  await sleep(500);
  return consumer;
};

const stopConsumer = async (consumer) => {
  const index = consumers.indexOf(consumer);
  if (index >= 0) {
    consumers.splice(index, 1);
  }
  await consumer.stop().catch(() => {});
};

const realDeadLetterPublisher = (topic) =>
  createKafkaDeadLetterPublisher({
    producer,
    topic,
    clock: { now: () => new Date() },
  });

describeKafka('consumidor Kafka contra broker real', () => {
  beforeAll(async () => {
    await admin.connect();
    await producer.connect();
  });

  afterEach(async () => {
    await Promise.allSettled(consumers.splice(0).map((consumer) => consumer.stop()));
  });

  afterAll(async () => {
    for (const topic of createdTopics.splice(0)) {
      await admin.deleteTopics({ topics: [topic] }).catch(() => {});
    }
    await producer.disconnect();
    await admin.disconnect();
  });

  test('reintenta fallos transitorios y confirma el offset', async () => {
    const topic = await createTopic('retry');
    const dlqTopic = await createTopic('retry-dlq');
    const groupId = uniqueName('group-retry');
    let calls = 0;

    const processDomainEvent = jest.fn(async () => {
      calls += 1;
      if (calls < 3) {
        throw new ServiceUnavailableError('fallo transitorio');
      }
      return { status: 'processed' };
    });

    await startConsumer({
      groupId,
      topic,
      processDomainEvent,
      deadLetterPublisher: realDeadLetterPublisher(dlqTopic),
    });

    await publish(topic, makeEvent());

    await waitFor(() => calls === 3, 'tres intentos');
    await waitFor(async () => (await committedOffset(groupId, topic)) === '1', 'commit del offset');

    expect(processDomainEvent).toHaveBeenCalledTimes(3);
    expect(await topicHighOffset(dlqTopic)).toBe(0);
  });

  test('agota reintentos y publica el evento en la DLQ', async () => {
    const topic = await createTopic('exhausted');
    const dlqTopic = await createTopic('exhausted-dlq');
    const groupId = uniqueName('group-exhausted');
    let calls = 0;
    const event = makeEvent();

    const processDomainEvent = jest.fn(async () => {
      calls += 1;
      throw new ServiceUnavailableError('fallo transitorio persistente');
    });

    await startConsumer({
      groupId,
      topic,
      processDomainEvent,
      deadLetterPublisher: realDeadLetterPublisher(dlqTopic),
    });

    await publish(topic, event);
    await waitFor(() => calls === 4, 'agotamiento de reintentos');

    const [message] = await readMessages(dlqTopic, 1);
    const payload = JSON.parse(message.value.toString('utf8'));

    expect(payload.reason).toBe('PROCESSING_ERROR');
    expect(payload.original_message).toBe(JSON.stringify(event));
    expect(message.headers['x-error-code'].toString()).toBe('SERVICE_UNAVAILABLE');
    await waitFor(
      async () => (await committedOffset(groupId, topic)) === '1',
      'commit posterior a la DLQ',
    );
  });

  test('envía un sobre inválido a la DLQ sin invocar el procesador', async () => {
    const topic = await createTopic('invalid-envelope');
    const dlqTopic = await createTopic('invalid-envelope-dlq');
    const groupId = uniqueName('group-envelope');
    const processDomainEvent = jest.fn();

    await startConsumer({
      groupId,
      topic,
      processDomainEvent,
      deadLetterPublisher: realDeadLetterPublisher(dlqTopic),
    });

    await publish(topic, 'esto-no-es-json');

    const [message] = await readMessages(dlqTopic, 1);
    const payload = JSON.parse(message.value.toString('utf8'));

    expect(payload.reason).toBe('INVALID_ENVELOPE');
    expect(processDomainEvent).not.toHaveBeenCalled();
    await waitFor(
      async () => (await committedOffset(groupId, topic)) === '1',
      'commit del sobre inválido',
    );
  });

  test('envía datos inválidos a la DLQ sin reintentar', async () => {
    const topic = await createTopic('invalid-data');
    const dlqTopic = await createTopic('invalid-data-dlq');
    const groupId = uniqueName('group-data');
    const processDomainEvent = jest.fn(async () => {
      throw new InvalidDataError('datos inválidos');
    });

    await startConsumer({
      groupId,
      topic,
      processDomainEvent,
      deadLetterPublisher: realDeadLetterPublisher(dlqTopic),
    });

    await publish(topic, makeEvent());

    const [message] = await readMessages(dlqTopic, 1);
    const payload = JSON.parse(message.value.toString('utf8'));

    expect(processDomainEvent).toHaveBeenCalledTimes(1);
    expect(payload.reason).toBe('INVALID_EVENT_DATA');
    await waitFor(
      async () => (await committedOffset(groupId, topic)) === '1',
      'commit de datos inválidos',
    );
  });

  test('no confirma el offset si falla la DLQ y reprocesa al reiniciar', async () => {
    const topic = await createTopic('dlq-failure');
    const dlqTopic = await createTopic('dlq-failure-dlq');
    const groupId = uniqueName('group-dlq-failure');
    const seed = makeEvent({ datos: { kind: 'seed' } });
    const failing = makeEvent({ datos: { kind: 'failing' } });
    let failingCalls = 0;

    const processDomainEvent = jest.fn(async (envelope) => {
      if (envelope.datos.kind === 'seed') {
        return { status: 'processed' };
      }
      failingCalls += 1;
      throw new InvalidDataError('datos inválidos');
    });

    const brokenPublisher = {
      publish: jest.fn(async () => {
        throw new Error('DLQ no disponible');
      }),
    };

    const firstConsumer = await startConsumer({
      groupId,
      topic,
      processDomainEvent,
      deadLetterPublisher: brokenPublisher,
    });

    await publish(topic, seed);
    await waitFor(
      async () => (await committedOffset(groupId, topic)) === '1',
      'commit del evento semilla',
    );

    await publish(topic, failing);
    await waitFor(() => failingCalls >= 1, 'primer fallo del evento');
    await sleep(100);

    expect(await committedOffset(groupId, topic)).toBe('1');
    await stopConsumer(firstConsumer);

    await startConsumer({
      groupId,
      topic,
      processDomainEvent,
      deadLetterPublisher: realDeadLetterPublisher(dlqTopic),
    });

    const [message] = await readMessages(dlqTopic, 1);
    const payload = JSON.parse(message.value.toString('utf8'));

    expect(failingCalls).toBeGreaterThan(1);
    expect(brokenPublisher.publish).toHaveBeenCalled();
    expect(payload.reason).toBe('INVALID_EVENT_DATA');
    await waitFor(
      async () => (await committedOffset(groupId, topic)) === '2',
      'commit posterior al reinicio',
    );
  });

  test('ignora eventos desconocidos y contratos pendientes sin enviarlos a la DLQ', async () => {
    const topic = await createTopic('ignored');
    const dlqTopic = await createTopic('ignored-dlq');
    const groupId = uniqueName('group-ignored');
    const context = createTestContext();
    const processDomainEvent = jest.fn(context.useCases.processDomainEvent);

    await startConsumer({
      groupId,
      topic,
      processDomainEvent,
      deadLetterPublisher: realDeadLetterPublisher(dlqTopic),
    });

    await publish(
      topic,
      makeEvent({
        evento_id: randomUUID(),
        tipo_evento: 'EventoNoSoportadoEvent',
      }),
    );
    await publish(
      topic,
      makeEvent({
        evento_id: randomUUID(),
        tipo_evento: 'AsignacionCreadaEvent',
      }),
    );

    await waitFor(() => processDomainEvent.mock.calls.length === 2, 'dos eventos ignorados');
    await waitFor(
      async () => (await committedOffset(groupId, topic)) === '2',
      'commit de eventos ignorados',
    );

    const results = await Promise.all(
      processDomainEvent.mock.results.map((result) => result.value),
    );

    expect(results.map((result) => result.status)).toEqual(['ignored', 'ignored']);
    expect(results.map((result) => result.reason)).toEqual([
      'unsupported_event_type',
      'pending_contract',
    ]);
    expect(context.state.alerts.size).toBe(0);
    expect(context.state.notifications.size).toBe(0);
    expect(await topicHighOffset(dlqTopic)).toBe(0);
  });

  test('no reprocesa offsets confirmados al reiniciar', async () => {
    const topic = await createTopic('restart');
    const dlqTopic = await createTopic('restart-dlq');
    const groupId = uniqueName('group-restart');
    const seen = [];
    const first = makeEvent();
    const second = makeEvent();

    const processDomainEvent = jest.fn(async (envelope) => {
      seen.push(envelope.evento_id);
      return { status: 'processed' };
    });

    const firstConsumer = await startConsumer({
      groupId,
      topic,
      processDomainEvent,
      deadLetterPublisher: realDeadLetterPublisher(dlqTopic),
    });

    await publish(topic, first);
    await waitFor(() => seen.length === 1, 'primer evento');
    await waitFor(
      async () => (await committedOffset(groupId, topic)) === '1',
      'commit del primer evento',
    );
    await stopConsumer(firstConsumer);

    await publish(topic, second);
    await startConsumer({
      groupId,
      topic,
      processDomainEvent,
      deadLetterPublisher: realDeadLetterPublisher(dlqTopic),
    });

    await waitFor(() => seen.length === 2, 'segundo evento');
    expect(seen).toEqual([first.evento_id, second.evento_id]);
    await waitFor(
      async () => (await committedOffset(groupId, topic)) === '2',
      'commit del segundo evento',
    );
  });
});
