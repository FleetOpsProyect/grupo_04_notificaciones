const { randomUUID } = require('node:crypto');
const { createFirestoreIntegrationContext } = require('../helpers/firestore-integration');
const {
  AttentionStatus,
  DispatchStatus,
  RecipientRole,
  Severity,
  Type,
} = require('../../src/domain/enums');

jest.setTimeout(60000);

const RUN = process.env.FIRESTORE_INTEGRATION === 'true';
const describeFirestore = RUN ? describe : describe.skip;

describeFirestore('repositorios Firestore contra proyecto real', () => {
  let context;

  beforeAll(() => {
    context = createFirestoreIntegrationContext();
  });

  afterEach(async () => {
    if (context) {
      await context.cleanup();
    }
  });

  afterAll(async () => {
    if (!context) {
      return;
    }
    try {
      await context.cleanup();
    } finally {
      await context.client.close();
    }
  });

  test('crea y lee alertas, notificaciones y eventos procesados', async () => {
    const alert = context.createAlert({
      severity: Severity.WARNING,
      reference_id: null,
      source_event_type: null,
    });
    await context.repositories.alerts.create(alert);

    const storedAlert = await context.repositories.alerts.findById(alert.alert_id);
    expect(storedAlert).toMatchObject({
      alert_id: alert.alert_id,
      severity: Severity.WARNING,
      reference_id: null,
      source_event_type: null,
      attention_status: AttentionStatus.PENDING,
    });
    expect(storedAlert.created_at).toBeInstanceOf(Date);

    const first = context.createNotification({
      alert_id: alert.alert_id,
      severity: Severity.WARNING,
      recipient_role: RecipientRole.MANAGEMENT,
      reference_id: null,
    });
    const second = context.createNotification({
      alert_id: alert.alert_id,
      severity: Severity.WARNING,
      recipient_role: RecipientRole.FLEET_ADMINISTRATOR,
      reference_id: null,
    });
    await context.repositories.notifications.createMany([first, second]);

    const storedNotification = await context.repositories.notifications.findById(
      first.notification_id,
    );
    expect(storedNotification).toMatchObject({
      notification_id: first.notification_id,
      alert_id: alert.alert_id,
      recipient_role: RecipientRole.MANAGEMENT,
      reference_id: null,
      dispatch_status: DispatchStatus.PENDING_DISPATCH,
      dispatch_attempts: 0,
    });
    expect(storedNotification.created_at).toBeInstanceOf(Date);
    expect(storedNotification.next_attempt_at).toBeInstanceOf(Date);

    const byAlert = await context.repositories.notifications.findByAlertId(alert.alert_id);
    expect(byAlert.map((item) => item.notification_id).sort()).toEqual(
      [first.notification_id, second.notification_id].sort(),
    );

    const eventId = randomUUID();
    context.trackProcessedEvent(eventId);
    await context.repositories.processedEvents.create({
      evento_id: eventId,
      event_type: 'IncidenteReportadoEvent',
      source: 'incident-service',
      topic: 'fleetops.incident.incident.v1',
      partition: 0,
      offset: 10,
      occurred_at: new Date('2026-10-25T12:00:00.000Z'),
      processed_at: new Date('2026-10-25T12:00:01.000Z'),
    });

    expect(await context.repositories.processedEvents.exists(eventId)).toBe(true);
    expect(await context.repositories.processedEvents.exists(randomUUID())).toBe(false);
  });

  test('deduplica un evento por evento_id dentro de la transacción real', async () => {
    const envelope = context.makeIncidentEnvelope();

    const first = await context.processDomainEvent(envelope, {
      topic: 'fleetops.incident.incident.v1',
      partition: 0,
      offset: 1,
    });
    expect(first.status).toBe('processed');
    expect(first.notification_ids).toHaveLength(2);

    const second = await context.processDomainEvent(envelope, {
      topic: 'fleetops.incident.incident.v1',
      partition: 0,
      offset: 2,
    });
    expect(second.status).toBe('duplicate');

    const alerts = await context.db
      .collection('alerts')
      .where('event_id', '==', envelope.evento_id)
      .get();
    const notifications = await context.db
      .collection('notifications')
      .where('event_id', '==', envelope.evento_id)
      .get();

    expect(alerts.size).toBe(1);
    expect(notifications.size).toBe(2);
    expect(await context.repositories.processedEvents.exists(envelope.evento_id)).toBe(true);
  });

  test('revierte la transacción cuando falla una escritura', async () => {
    const alert = context.createAlert();

    await expect(
      context.unitOfWork.run(async (transaction) => {
        await transaction.alerts.create(alert);
        throw new Error('fallo intencional después de escribir');
      }),
    ).rejects.toThrow('Firestore no está disponible');

    const snapshot = await context.db.collection('alerts').doc(alert.alert_id).get();
    expect(snapshot.exists).toBe(false);
  });

  test('atiende la alerta y todas sus notificaciones en una sola transacción', async () => {
    const alert = context.createAlert({ severity: Severity.WARNING });
    await context.repositories.alerts.create(alert);

    const first = context.createNotification({
      alert_id: alert.alert_id,
      severity: Severity.WARNING,
    });
    const second = context.createNotification({
      alert_id: alert.alert_id,
      severity: Severity.WARNING,
    });
    await context.repositories.notifications.createMany([first, second]);

    const result = await context.markAlertAttended(first.notification_id);
    expect(result.alert_id).toBe(alert.alert_id);
    expect(result.attention_status).toBe(AttentionStatus.ATTENDED);

    const storedAlert = await context.repositories.alerts.findById(alert.alert_id);
    expect(storedAlert.attention_status).toBe(AttentionStatus.ATTENDED);
    expect(storedAlert.attended_at).toBeInstanceOf(Date);

    const notifications = await context.repositories.notifications.findByAlertId(alert.alert_id);
    expect(notifications).toHaveLength(2);
    for (const notification of notifications) {
      expect(notification.attention_status).toBe(AttentionStatus.ATTENDED);
      expect(notification.attended_at).toBeInstanceOf(Date);
    }

    const repeated = await context.markAlertAttended(second.notification_id);
    expect(repeated.attention_status).toBe(AttentionStatus.ATTENDED);
  });

  test('gestiona reserva, expiración de lease y transiciones de despacho', async () => {
    const now = new Date();
    const due = new Date(now.getTime() - 1000);
    const notification = context.createNotification({
      created_at: due,
      next_attempt_at: due,
    });
    await context.repositories.notifications.createMany([notification]);

    const pending = await context.repositories.notifications.findDuePending(now, 1000);
    expect(pending.some((item) => item.notification_id === notification.notification_id)).toBe(
      true,
    );

    const claimed = await context.repositories.notifications.claimForDispatch(
      notification.notification_id,
      now,
      2000,
    );
    expect(claimed.locked_until).toBeInstanceOf(Date);
    expect(
      await context.repositories.notifications.claimForDispatch(
        notification.notification_id,
        now,
        2000,
      ),
    ).toBeNull();

    await context.repositories.notifications.releaseClaim(notification.notification_id);
    const reclaimed = await context.repositories.notifications.claimForDispatch(
      notification.notification_id,
      now,
      2000,
    );
    expect(reclaimed.locked_until).not.toBeNull();

    const sent = reclaimed.markSent(now, `provider-${context.runId}`);
    await context.repositories.notifications.markSent(sent);
    const storedSent = await context.repositories.notifications.findById(
      notification.notification_id,
    );
    expect(storedSent.dispatch_status).toBe(DispatchStatus.SENT);
    expect(storedSent.provider_message_id).toBe(`provider-${context.runId}`);
    expect(storedSent.sent_at).toBeInstanceOf(Date);
    expect(storedSent.locked_until).toBeNull();

    const expiring = context.createNotification({
      created_at: due,
      next_attempt_at: due,
    });
    await context.repositories.notifications.createMany([expiring]);
    const expiringClaim = await context.repositories.notifications.claimForDispatch(
      expiring.notification_id,
      now,
      50,
    );
    expect(expiringClaim.locked_until).not.toBeNull();
    const afterLease = await context.repositories.notifications.claimForDispatch(
      expiring.notification_id,
      new Date(now.getTime() + 5000),
      2000,
    );
    expect(afterLease).not.toBeNull();

    const failed = context.createNotification({
      created_at: due,
      next_attempt_at: due,
    });
    await context.repositories.notifications.createMany([failed]);
    const failedClaim = await context.repositories.notifications.claimForDispatch(
      failed.notification_id,
      now,
      2000,
    );
    await context.repositories.notifications.markFailed(
      failedClaim.markFailed(now, 'IT_FAILURE', 1),
    );
    const storedFailed = await context.repositories.notifications.findById(failed.notification_id);
    expect(storedFailed.dispatch_status).toBe(DispatchStatus.FAILED);
    expect(storedFailed.dispatch_attempts).toBe(1);
    expect(storedFailed.failure_reason).toBe('IT_FAILURE');
    expect(storedFailed.next_attempt_at).toBeNull();
    expect(storedFailed.locked_until).toBeNull();

    const retried = context.createNotification({
      created_at: due,
      next_attempt_at: due,
    });
    await context.repositories.notifications.createMany([retried]);
    const retriedClaim = await context.repositories.notifications.claimForDispatch(
      retried.notification_id,
      now,
      2000,
    );
    const nextAttempt = new Date(now.getTime() + 60000);
    await context.repositories.notifications.scheduleRetry(
      retriedClaim.scheduleRetry(nextAttempt, 'IT_RETRY', 1),
    );
    const storedRetried = await context.repositories.notifications.findById(
      retried.notification_id,
    );
    expect(storedRetried.dispatch_status).toBe(DispatchStatus.PENDING_DISPATCH);
    expect(storedRetried.dispatch_attempts).toBe(1);
    expect(storedRetried.failure_reason).toBe('IT_RETRY');
    expect(storedRetried.next_attempt_at).toEqual(nextAttempt);
    expect(storedRetried.locked_until).toBeNull();
  });

  test('filtra, pagina y resume notificaciones; usa fallback sin índice compuesto', async () => {
    const now = new Date();
    const older = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const middle = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const newer = new Date(now.getTime() - 60 * 60 * 1000);

    const critical = context.createNotification({
      severity: Severity.CRITICAL,
      dispatch_status: DispatchStatus.PENDING_DISPATCH,
      type: Type.INCIDENT,
      created_at: older,
      next_attempt_at: older,
    });
    const warning = context.createNotification({
      severity: Severity.WARNING,
      dispatch_status: DispatchStatus.SENT,
      type: Type.ASSIGNMENT,
      recipient_role: RecipientRole.MANAGEMENT,
      attention_status: AttentionStatus.ATTENDED,
      attended_at: middle,
      created_at: middle,
      next_attempt_at: middle,
      sent_at: middle,
      provider_message_id: 'provider-search',
    });
    const informational = context.createNotification({
      severity: Severity.INFORMATIONAL,
      dispatch_status: DispatchStatus.FAILED,
      type: Type.DOCUMENT,
      created_at: newer,
      next_attempt_at: newer,
      failure_reason: 'SEARCH_FAILURE',
    });
    const latestWarning = context.createNotification({
      severity: Severity.WARNING,
      dispatch_status: DispatchStatus.PENDING_DISPATCH,
      type: Type.INCIDENT,
      created_at: now,
      next_attempt_at: now,
    });
    await context.repositories.notifications.createMany([
      critical,
      warning,
      informational,
      latestWarning,
    ]);

    const firstPage = await context.repositories.notifications.search({
      filters: { reference_id: context.runId },
      page: 0,
      size: 2,
    });
    expect(firstPage.total).toBe(4);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.items.map((item) => item.notification_id)).toEqual([
      latestWarning.notification_id,
      informational.notification_id,
    ]);
    expect(firstPage.summary.by_severity).toEqual({
      CRITICAL: 1,
      WARNING: 2,
      INFORMATIONAL: 1,
    });
    expect(firstPage.summary.by_dispatch_status).toEqual({
      PENDING_DISPATCH: 2,
      SENT: 1,
      FAILED: 1,
    });

    const secondPage = await context.repositories.notifications.search({
      filters: { reference_id: context.runId },
      page: 1,
      size: 2,
    });
    expect(secondPage.items.map((item) => item.notification_id)).toEqual([
      warning.notification_id,
      critical.notification_id,
    ]);

    const sent = await context.repositories.notifications.search({
      filters: { reference_id: context.runId, dispatch_status: DispatchStatus.SENT },
      page: 0,
      size: 10,
    });
    expect(sent.total).toBe(1);
    expect(sent.items[0].notification_id).toBe(warning.notification_id);

    const fallback = await context.repositories.notifications.search({
      filters: {
        reference_id: context.runId,
        severity: Severity.WARNING,
        recipient_role: RecipientRole.MANAGEMENT,
      },
      page: 0,
      size: 10,
    });
    expect(fallback.total).toBe(1);
    expect(fallback.items[0].notification_id).toBe(warning.notification_id);
    expect(fallback.summary.by_severity.WARNING).toBe(1);
  });

  test('cuenta alertas críticas pendientes y devuelve vacío para documentos inexistentes', async () => {
    const before = await context.repositories.alerts.countCriticalPending();
    const alert = context.createAlert({
      severity: Severity.CRITICAL,
      attention_status: AttentionStatus.PENDING,
    });
    await context.repositories.alerts.create(alert);

    expect(await context.repositories.alerts.countCriticalPending()).toBeGreaterThanOrEqual(
      before + 1,
    );
    expect(await context.repositories.alerts.findById(randomUUID())).toBeNull();
    expect(await context.repositories.notifications.findById(randomUUID())).toBeNull();
    expect(await context.repositories.notifications.findByAlertId(randomUUID())).toEqual([]);
    expect(await context.repositories.notifications.countAll()).toBeGreaterThanOrEqual(0);
  });
});
