const {
  createKafkaDeadLetterPublisher,
} = require('../../src/adapters/out/kafka/kafka-dead-letter.publisher');

describe('Kafka dead letter publisher', () => {
  test('enmascara correos en el error y no agrega contenido de la notificación', async () => {
    const producer = { send: jest.fn().mockResolvedValue({}) };
    const clock = { now: () => new Date('2026-10-25T15:00:00.000Z') };
    const publisher = createKafkaDeadLetterPublisher({
      producer,
      topic: 'notifications-dlq',
      clock,
    });

    await publisher.publish({
      originalMessage: {
        key: Buffer.from('event-1'),
        value: Buffer.from(
          JSON.stringify({ evento_id: 'event-1', tipo_evento: 'IncidenteReportadoEvent' }),
        ),
      },
      reason: 'INVALID_EVENT_DATA',
      error: new Error('fallo para persona@example.com'),
      context: { topic: 'notifications-events', partition: 0, offset: 12 },
    });

    const sent = producer.send.mock.calls[0][0];
    const payload = JSON.parse(sent.messages[0].value);
    expect(payload).toMatchObject({
      reason: 'INVALID_EVENT_DATA',
      topic: 'notifications-events',
      partition: 0,
      offset: 12,
      failed_at: '2026-10-25T15:00:00.000Z',
      error: { error_message: 'fallo para p***@example.com' },
    });
    expect(payload).not.toHaveProperty('notification');
    expect(payload).not.toHaveProperty('recipient_email');
    expect(payload).not.toHaveProperty('message');
    expect(JSON.stringify(payload)).not.toContain('persona@example.com');
  });
});
