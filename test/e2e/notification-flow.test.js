const { createTestContext, eventEnvelope } = require('../helpers/test-context');

describe('flujo E2E por casos de uso', () => {
  test('evento -> persistencia -> despacho -> consulta -> reconocimiento', async () => {
    const context = createTestContext();
    const processed = await context.useCases.processDomainEvent(eventEnvelope(), {
      queue_url: 'http://localhost/queue.fifo',
      message_id: 'msg-1',
    });
    expect(processed.status).toBe('processed');

    const dispatched = await context.useCases.dispatchPendingNotifications({ limit: 10 });
    expect(dispatched.sent).toBe(2);

    const status = await context.useCases.getNotificationStatus();
    expect(status.deliveries).toEqual({ pending: 0, sent: 2, failed: 0 });

    const listed = await context.useCases.listNotifications({
      page: 0,
      size: 20,
      delivery_status: 'SENT',
    });
    expect(listed.total).toBe(2);

    const detail = await context.useCases.getNotification(processed.notification_ids[0]);
    expect(detail).toMatchObject({
      delivery_status: 'SENT',
      provider_message_id: 'provider-1',
      alert_id: processed.alert_id,
    });
    expect(detail.sent_at).toMatch(/^-05:00$|.*-05:00$/);
    expect(detail.recipient_email).toBe('a***@example.com');

    const attended = await context.useCases.acknowledgeAlert(processed.notification_ids[0]);
    expect(attended.acknowledgement_status).toBe('ACKNOWLEDGED');

    const after = await context.useCases.getNotification(processed.notification_ids[1]);
    expect(after.acknowledgement_status).toBe('ACKNOWLEDGED');
    expect(after.acknowledged_at).toBe(attended.acknowledged_at);
  });

  test('el duplicado no reenvía correos ni duplica registros', async () => {
    const context = createTestContext();
    const first = await context.useCases.processDomainEvent(eventEnvelope());
    const second = await context.useCases.processDomainEvent(eventEnvelope());
    expect(first.status).toBe('processed');
    expect(second.status).toBe('duplicate');
    expect(context.state.alerts.size).toBe(1);
    expect(context.state.notifications.size).toBe(2);

    await context.useCases.dispatchPendingNotifications({ limit: 10 });
    await context.useCases.dispatchPendingNotifications({ limit: 10 });
    expect(context.emailSender.send).toHaveBeenCalledTimes(2);
    expect(context.state.notifications.size).toBe(2);
  });
});
