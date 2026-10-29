const {
  createSnsEventPublisher,
} = require('../../src/adapters/out/sns/sns-event.publisher');
const { createTestContext, eventEnvelope } = require('../helpers/test-context');

const outboxOf = (context, eventType) =>
  [...context.state.outboxEvents.values()].filter((record) => record.event_type === eventType);

describe('emisión de eventos propios en la transacción', () => {
  test('un evento de dominio genera un notification_created_event por notificación', async () => {
    const context = createTestContext();
    const processed = await context.useCases.processDomainEvent(eventEnvelope());

    const created = outboxOf(context, 'notification_created_event');
    expect(created).toHaveLength(2);
    expect(created.map((record) => record.notification_id).sort()).toEqual(
      [...processed.notification_ids].sort(),
    );
    for (const record of created) {
      expect(record.status).toBe('PENDING');
      expect(record.publish_attempts).toBe(0);
      expect(record.data).toMatchObject({
        alert_id: processed.alert_id,
        type: 'INCIDENT',
        severity: 'CRITICAL',
        origin: 'EVENT',
        source_event_id: eventEnvelope().event_id,
      });
      expect(record.notification_id).toBe(record.data.notification_id);
    }
  });

  test('la creación manual emite notification_created_event con origen MANUAL', async () => {
    const context = createTestContext();
    const result = await context.useCases.createManualNotification({
      type: 'GENERAL',
      severity: 'INFO',
      recipient_role: 'MANAGEMENT',
      message: 'Mensaje manual',
      correlation_id: 'corr-manual',
    });

    const created = outboxOf(context, 'notification_created_event');
    expect(created).toHaveLength(1);
    expect(created[0].notification_id).toBe(result.notification_id);
    expect(created[0].data).toMatchObject({
      origin: 'MANUAL',
      source_event_id: null,
      reference_id: null,
    });
  });

  test('el despacho emite notification_sent_event y notification_failed_event', async () => {
    const context = createTestContext();
    await context.useCases.processDomainEvent(eventEnvelope());
    await context.useCases.dispatchPendingNotifications({ limit: 10 });

    expect(outboxOf(context, 'notification_sent_event')).toHaveLength(2);
    expect(outboxOf(context, 'notification_failed_event')).toHaveLength(0);
  });

  test('un destinatario no configurado emite notification_failed_event', async () => {
    const context = createTestContext({
      recipients: {
        FLEET_ADMINISTRATOR: 'admin@example.com',
        MAINTENANCE_TECHNICIAN: 'tecnico@example.com',
      },
    });
    await context.useCases.createManualNotification({
      type: 'GENERAL',
      severity: 'WARNING',
      recipient_role: 'MANAGEMENT',
      message: 'Sin destinatario',
      correlation_id: 'corr',
    });
    await context.useCases.dispatchPendingNotifications({ limit: 10 });

    const failed = outboxOf(context, 'notification_failed_event');
    expect(failed).toHaveLength(1);
    expect(failed[0].data.failure_reason).toBe('RECIPIENT_NOT_CONFIGURED');
  });

  test('el reconocimiento emite un evento por notificación y es idempotente', async () => {
    const context = createTestContext();
    const processed = await context.useCases.processDomainEvent(eventEnvelope());

    await context.useCases.acknowledgeAlert(processed.notification_ids[0]);
    expect(outboxOf(context, 'notification_acknowledged_event')).toHaveLength(2);

    await context.useCases.acknowledgeAlert(processed.notification_ids[1]);
    expect(outboxOf(context, 'notification_acknowledged_event')).toHaveLength(2);
  });
});

describe('PublishOutboxEvents', () => {
  test('publica los eventos pendientes y los marca PUBLISHED', async () => {
    const context = createTestContext();
    await context.useCases.processDomainEvent(eventEnvelope());

    const result = await context.useCases.publishOutboxEvents({ limit: 10 });

    expect(result).toEqual({ claimed: 2, published: 2, failed: 0, skipped: false });
    expect(context.eventPublisher.publish).toHaveBeenCalledTimes(2);
    const [envelope, options] = context.eventPublisher.publish.mock.calls[0];
    expect(envelope).toMatchObject({
      event_type: 'notification_created_event',
      version: 1,
      source: 'notification',
    });
    expect(envelope.data.notification_id).toBeDefined();
    expect(options.groupId).toBe(envelope.data.notification_id);
    expect(options.deduplicationId).toBe(envelope.event_id);
    expect(options.messageAttributes).toEqual({ event_type: 'notification_created_event' });
    expect(outboxOf(context, 'notification_created_event').every((r) => r.status === 'PUBLISHED')).toBe(
      true,
    );
  });

  test('reprograma el evento si SNS falla', async () => {
    const context = createTestContext();
    await context.useCases.createManualNotification({
      type: 'GENERAL',
      severity: 'INFO',
      recipient_role: 'MANAGEMENT',
      message: 'Mensaje',
      correlation_id: 'corr',
    });
    context.eventPublisher.publish.mockRejectedValueOnce(new Error('SNS caído'));

    const result = await context.useCases.publishOutboxEvents({ limit: 10 });

    expect(result).toEqual({ claimed: 1, published: 0, failed: 1, skipped: false });
    const record = outboxOf(context, 'notification_created_event')[0];
    expect(record.status).toBe('PENDING');
    expect(record.publish_attempts).toBe(1);
    expect(record.next_attempt_at.getTime()).toBeGreaterThan(context.clock.now().getTime());
  });

  test('no hace nada si no hay publicador configurado', async () => {
    const context = createTestContext({ eventPublisher: null });
    const result = await context.useCases.publishOutboxEvents();

    expect(result).toEqual({ claimed: 0, published: 0, failed: 0, skipped: true });
  });
});

describe('SnsEventPublisher', () => {
  test('incluye grupo, deduplicación y atributos para SNS FIFO', async () => {
    const send = jest.fn().mockResolvedValue({});
    const publisher = createSnsEventPublisher({
      snsClient: { send },
      topicArn: 'arn:aws:sns:us-east-1:000000000000:fleetops_notification_events.fifo',
    });

    await publisher.publish(
      { event_id: 'evt-1', event_type: 'notification_created_event', data: {} },
      {
        groupId: 'notification-1',
        deduplicationId: 'evt-1',
        messageAttributes: { event_type: 'notification_created_event' },
      },
    );

    const input = send.mock.calls[0][0].input;
    expect(input.TopicArn).toContain('fleetops_notification_events.fifo');
    expect(input.MessageGroupId).toBe('notification-1');
    expect(input.MessageDeduplicationId).toBe('evt-1');
    expect(input.MessageAttributes.event_type).toEqual({
      DataType: 'String',
      StringValue: 'notification_created_event',
    });
  });

  test('falla si falta el ARN del topic', async () => {
    const publisher = createSnsEventPublisher({ snsClient: { send: jest.fn() }, topicArn: null });
    await expect(publisher.publish({})).rejects.toThrow('SNS_NOTIFICATION_TOPIC_ARN no configurado');
  });
});

describe('constructores de eventos propios', () => {
  const {
    buildCreatedEvent,
    buildSentEvent,
    buildFailedEvent,
    buildAcknowledgedEvent,
    createOutboxRecord,
  } = require('../../src/application/shared/notification-events');

  test('usan valores por defecto cuando faltan opcionales', () => {
    const now = new Date('2026-10-22T15:00:00.000Z');
    const notification = {
      notification_id: 'n-1',
      alert_id: 'a-1',
      type: 'GENERAL',
      severity: 'INFO',
      recipient_role: 'MANAGEMENT',
      reference_id: null,
      origin: 'EVENT',
      event_id: null,
      correlation_id: null,
      created_at: now,
      sent_at: now,
      delivery_attempts: 1,
      failure_reason: 'ERROR',
    };

    const created = buildCreatedEvent(notification);
    expect(created.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.correlation_id).toBeNull();
    expect(created.next_attempt_at).toBe(now);

    expect(buildSentEvent(notification).data.sent_at).toBe(now.toISOString());
    expect(buildFailedEvent(notification).data.failure_reason).toBe('ERROR');
    expect(buildAcknowledgedEvent(notification, { acknowledgedAt: now }).data.acknowledged_at).toBe(
      now.toISOString(),
    );

    const custom = createOutboxRecord({
      eventType: 'x',
      notificationId: 'n-1',
      data: {},
      createdAt: now,
      eventId: 'fixed-id',
    });
    expect(custom.event_id).toBe('fixed-id');
    expect(custom.correlation_id).toBeNull();
  });
});
