const { createTestContext, eventEnvelope } = require('../helpers/test-context');

describe('flujo E2E por casos de uso', () => {
  test('evento -> persistencia -> despacho -> consulta -> atención', async () => {
    const context = createTestContext();
    const processed = await context.useCases.processDomainEvent(eventEnvelope(), {
      topic: 'fleetops.incident.incident.v1',
      partition: 0,
      offset: '10',
    });
    expect(processed.status).toBe('processed');

    const dispatched = await context.useCases.dispatchPendingNotifications({ limit: 10 });
    expect(dispatched.sent).toBe(2);

    const status = await context.useCases.getNotificationStatus();
    expect(status.dispatch).toEqual({ pending: 0, sent: 2, failed: 0 });

    const listed = await context.useCases.listNotifications({
      page: 0,
      size: 20,
      dispatch_status: 'SENT',
    });
    expect(listed.total).toBe(2);

    const detail = await context.useCases.getNotification(processed.notification_ids[0]);
    expect(detail).toMatchObject({
      dispatch_status: 'SENT',
      provider_message_id: 'provider-1',
      alert_id: processed.alert_id,
    });
    expect(detail.sent_at).toMatch(/^-05:00$|.*-05:00$/);
    expect(detail.recipient_email).toBe('a***@example.com');

    const attended = await context.useCases.markAlertAttended(processed.notification_ids[0]);
    expect(attended.attention_status).toBe('ATTENDED');

    const after = await context.useCases.getNotification(processed.notification_ids[1]);
    expect(after.attention_status).toBe('ATTENDED');
    expect(after.attended_at).toBe(attended.attended_at);
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
