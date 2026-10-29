const { createMessageHandler } = require('../../src/adapters/in/sqs/sqs-event.consumer');
const { ServiceUnavailableError } = require('../../src/domain/errors');

const validEnvelope = {
  event_id: '11111111-1111-4111-8111-111111111111',
  event_type: 'severe_incident_reported_event',
  version: 1,
  occurred_at: '2026-10-28T10:00:00-05:00',
  source: 'incident-service',
  correlation_id: '22222222-2222-4222-8222-222222222222',
  data: { incidente_id: 'inc-1' },
};

const buildMessage = (overrides = {}) => ({
  MessageId: 'msg-1',
  ReceiptHandle: 'rh-1',
  Body: JSON.stringify(validEnvelope),
  Attributes: { ApproximateReceiveCount: '1', MessageGroupId: 'group-1' },
  MessageAttributes: {
    event_type: { DataType: 'String', StringValue: validEnvelope.event_type },
  },
  ...overrides,
});

const buildHarness = ({ processDomainEvent, receiveCount = 1, overrides = {} } = {}) => {
  const sqsClient = { send: jest.fn().mockResolvedValue({}) };
  const deadLetterPublisher = { publish: jest.fn().mockResolvedValue() };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const metrics = { dlqMessages: { inc: jest.fn() } };
  const handler = createMessageHandler({
    sqsClient,
    sqsConfig: { consumerRetryDelaysMs: [2000, 10000, 30000], maxReceiveCount: 4 },
    queueUrl: 'http://localhost/queue.fifo',
    processDomainEvent:
      processDomainEvent ?? jest.fn().mockResolvedValue({ status: 'processed' }),
    deadLetterPublisher,
    logger,
    metrics,
  });
  const message = buildMessage({
    Attributes: { ApproximateReceiveCount: String(receiveCount), MessageGroupId: 'group-1' },
    ...overrides,
  });
  return { handler, message, sqsClient, deadLetterPublisher, logger, metrics };
};

const commandsOf = (sqsClient, name) =>
  sqsClient.send.mock.calls.map((call) => call[0]).filter((cmd) => cmd.constructor.name === name);

describe('consumidor SQS', () => {
  test('procesa y borra el mensaje sin tocar la visibilidad', async () => {
    const { handler, message, sqsClient, deadLetterPublisher } = buildHarness();

    await handler(message);

    expect(commandsOf(sqsClient, 'DeleteMessageCommand')).toHaveLength(1);
    expect(commandsOf(sqsClient, 'ChangeMessageVisibilityCommand')).toHaveLength(0);
    expect(deadLetterPublisher.publish).not.toHaveBeenCalled();
  });

  test('envía a DLQ un sobre inválido y borra el mensaje', async () => {
    const { handler, sqsClient, deadLetterPublisher } = buildHarness();
    const message = buildMessage({ Body: '{"event_id":"no-uuid"}' });

    await handler(message);

    expect(deadLetterPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'INVALID_ENVELOPE',
        context: expect.objectContaining({ receive_count: 1 }),
      }),
    );
    expect(commandsOf(sqsClient, 'DeleteMessageCommand')).toHaveLength(1);
  });

  test('envía a DLQ un error permanente de datos', async () => {
    const error = new (require('../../src/domain/errors').InvalidDataError)('Datos inválidos');
    const { handler, message, deadLetterPublisher } = buildHarness({
      processDomainEvent: jest.fn().mockRejectedValue(error),
    });

    await handler(message);

    expect(deadLetterPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'INVALID_EVENT_DATA' }),
    );
  });

  test.each([
    [1, 2],
    [2, 10],
    [3, 30],
  ])(
    'reprograma la visibilidad con receive_count=%i en %i segundos',
    async (receiveCount, expectedSeconds) => {
      const { handler, message, sqsClient, deadLetterPublisher } = buildHarness({
        processDomainEvent: jest.fn().mockRejectedValue(new ServiceUnavailableError('caído')),
        receiveCount,
      });

      await handler(message);

      const [command] = commandsOf(sqsClient, 'ChangeMessageVisibilityCommand');
      expect(command.input.VisibilityTimeout).toBe(expectedSeconds);
      expect(commandsOf(sqsClient, 'DeleteMessageCommand')).toHaveLength(0);
      expect(deadLetterPublisher.publish).not.toHaveBeenCalled();
    },
  );

  test('al alcanzar maxReceiveCount envía a DLQ con MAX_RECEIVE_COUNT', async () => {
    const { handler, message, sqsClient, deadLetterPublisher } = buildHarness({
      processDomainEvent: jest.fn().mockRejectedValue(new ServiceUnavailableError('caído')),
      receiveCount: 4,
    });

    await handler(message);

    expect(deadLetterPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'MAX_RECEIVE_COUNT',
        context: expect.objectContaining({ receive_count: 4 }),
      }),
    );
    expect(commandsOf(sqsClient, 'ChangeMessageVisibilityCommand')).toHaveLength(0);
    expect(commandsOf(sqsClient, 'DeleteMessageCommand')).toHaveLength(1);
  });

  test('si la publicación en DLQ falla, no borra el mensaje', async () => {
    const { handler, message, sqsClient, deadLetterPublisher } = buildHarness({
      processDomainEvent: jest.fn().mockRejectedValue(new ServiceUnavailableError('caído')),
      receiveCount: 4,
    });
    deadLetterPublisher.publish.mockRejectedValueOnce(new Error('DLQ caída'));

    await expect(handler(message)).rejects.toThrow('DLQ caída');
    expect(commandsOf(sqsClient, 'DeleteMessageCommand')).toHaveLength(0);
  });
});
