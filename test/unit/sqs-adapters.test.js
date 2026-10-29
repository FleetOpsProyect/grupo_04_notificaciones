const { randomUUID } = require('node:crypto');
const { mapSqsMessageToEnvelope } = require('../../src/adapters/in/sqs/sqs-message.mapper');
const {
  createSqsDeadLetterPublisher,
} = require('../../src/adapters/out/sqs/sqs-dead-letter.publisher');
const { InvalidDataError } = require('../../src/domain/errors');

const buildEnvelope = (overrides = {}) => ({
  event_id: randomUUID(),
  event_type: 'severe_incident_reported_event',
  version: 1,
  occurred_at: '2026-10-28T10:00:00-05:00',
  source: 'incidentes',
  correlation_id: randomUUID(),
  data: { incidente_id: 'inc-1' },
  ...overrides,
});

describe('Adaptador de entrada SQS', () => {
  test('mapea un Body JSON directo al sobre estándar', () => {
    const envelope = buildEnvelope();
    const mapped = mapSqsMessageToEnvelope({ Body: JSON.stringify(envelope) });

    expect(mapped.event_id).toBe(envelope.event_id);
    expect(mapped.event_type).toBe(envelope.event_type);
    expect(mapped.data).toEqual(envelope.data);
  });

  test('desenvuelve el Body de una notificación SNS', () => {
    const envelope = buildEnvelope();
    const snsBody = JSON.stringify({
      Type: 'Notification',
      MessageId: randomUUID(),
      Message: JSON.stringify(envelope),
    });

    const mapped = mapSqsMessageToEnvelope({ Body: snsBody });

    expect(mapped.event_id).toBe(envelope.event_id);
  });

  test('genera correlation_id cuando el sobre no lo trae', () => {
    const envelope = buildEnvelope();
    delete envelope.correlation_id;

    const mapped = mapSqsMessageToEnvelope({ Body: JSON.stringify(envelope) });

    expect(typeof mapped.correlation_id).toBe('string');
    expect(mapped.correlation_id.length).toBeGreaterThan(0);
  });

  test('rechaza un Body sin JSON válido', () => {
    expect(() => mapSqsMessageToEnvelope({ Body: '{' })).toThrow(InvalidDataError);
  });

  test('rechaza un sobre sin evento_id UUID', () => {
    const envelope = buildEnvelope({ event_id: 'no-es-uuid' });

    expect(() => mapSqsMessageToEnvelope({ Body: JSON.stringify(envelope) })).toThrow(
      InvalidDataError,
    );
  });

  test('rechaza un mensaje SQS sin Body', () => {
    expect(() => mapSqsMessageToEnvelope({})).toThrow('Mensaje SQS sin Body');
  });

  test('valida el message attribute event_type', () => {
    const envelope = buildEnvelope();
    expect(() =>
      mapSqsMessageToEnvelope({
        Body: JSON.stringify(envelope),
        MessageAttributes: {
          event_type: { DataType: 'String', StringValue: 'minor_incident_reported_event' },
        },
      }),
    ).toThrow('no coincide');

    const mapped = mapSqsMessageToEnvelope({
      Body: JSON.stringify(envelope),
      MessageAttributes: {
        event_type: { DataType: 'String', StringValue: envelope.event_type },
      },
    });
    expect(mapped.event_id).toBe(envelope.event_id);
  });
});

describe('Publicador SQS de DLQ', () => {
  test('publica con MessageGroupId y deduplicación obligatorios para FIFO', async () => {
    const send = jest.fn().mockResolvedValue({});
    const clock = { now: () => new Date('2026-10-28T15:00:00.000Z') };
    const publisher = createSqsDeadLetterPublisher({
      sqsClient: { send },
      dlqUrl: 'http://localhost:4566/000000000000/notifications_dlq.fifo',
      clock,
    });

    await publisher.publish({
      originalMessage: { Body: '{"evento_id":"x"}', MessageId: 'msg-1' },
      reason: 'INVALID_ENVELOPE',
      error: { code: 'INVALID_DATA', message: 'Sobre inválido' },
      context: { event_id: 'evt-1' },
    });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    const input = command.input;

    expect(input.QueueUrl).toContain('notifications_dlq.fifo');
    expect(input.MessageGroupId).toBe('evt-1');
    expect(input.MessageDeduplicationId).toContain('evt-1');

    const body = JSON.parse(input.MessageBody);
    expect(body.reason).toBe('INVALID_ENVELOPE');
    expect(body.original_message).toBe('{"evento_id":"x"}');
    expect(body.failed_at).toBe('2026-10-28T15:00:00.000Z');
    expect(input.MessageAttributes.reason.StringValue).toBe('INVALID_ENVELOPE');
  });

  test('falla si no hay DLQ configurada', async () => {
    const publisher = createSqsDeadLetterPublisher({
      sqsClient: { send: jest.fn() },
      dlqUrl: null,
      clock: { now: () => new Date() },
    });

    await expect(publisher.publish({ originalMessage: {}, reason: 'X' })).rejects.toThrow(
      'SQS_DLQ_URL no configurado',
    );
  });
});
