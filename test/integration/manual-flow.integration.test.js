const { randomUUID } = require('node:crypto');
const request = require('supertest');

const mockEmailSender = {
  send: jest.fn(),
};

jest.mock('../../src/adapters/out/email/console-email-sender', () => ({
  createConsoleEmailSender: jest.fn(() => mockEmailSender),
}));

const { config: baseConfig } = require('../../src/config/env');
const { createContainer } = require('../../src/config/composition-root');
const { Notification } = require('../../src/domain/entities/notification');
const {
  createNotificationFirestoreRepository,
} = require('../../src/adapters/out/firestore/notification.firestore.repository');
const {
  AcknowledgementStatus,
  DeliveryStatus,
  Origin,
  RecipientRole,
  Severity,
  Type,
} = require('../../src/domain/enums');
const { EmailDeliveryError } = require('../../src/domain/errors');

jest.setTimeout(60000);

const RUN = process.env.FIRESTORE_INTEGRATION === 'true';
const describeFirestore = RUN ? describe : describe.skip;

const buildConfig = () => ({
  ...baseConfig,
  logLevel: 'silent',
  dispatch: { ...baseConfig.dispatch, intervalMs: 600000, batchSize: 20 },
  recipients: {
    ...baseConfig.recipients,
    FLEET_ADMINISTRATOR: 'admin@test.invalid',
    MAINTENANCE_TECHNICIAN: 'tech@test.invalid',
    MANAGEMENT: 'management@test.invalid',
  },
  enableSwagger: false,
});

const createReferenceId = () => `it-manual-${Date.now()}-${randomUUID().slice(0, 8)}`;

const manualPayload = (referenceId, overrides = {}) => ({
  type: Type.INCIDENT,
  severity: Severity.WARNING,
  recipient_role: RecipientRole.FLEET_ADMINISTRATOR,
  message: 'Mensaje manual de integración',
  reference_id: referenceId,
  ...overrides,
});

const buildSecondNotification = (alertId, referenceId) =>
  new Notification({
    notification_id: randomUUID(),
    alert_id: alertId,
    type: Type.INCIDENT,
    severity: Severity.WARNING,
    recipient_role: RecipientRole.MANAGEMENT,
    recipient_email: null,
    subject: 'Segunda notificación de integración',
    message: 'Segunda notificación de integración',
    reference_id: referenceId,
    origin: Origin.MANUAL,
    source_event_type: null,
    event_id: null,
    correlation_id: randomUUID(),
    acknowledgement_status: AcknowledgementStatus.PENDING,
    acknowledged_at: null,
    delivery_status: DeliveryStatus.PENDING,
    delivery_attempts: 0,
    next_attempt_at: new Date(Date.now() + 60 * 60 * 1000),
    locked_until: null,
    failure_reason: null,
    provider_message_id: null,
    created_at: new Date(),
    sent_at: null,
  });

const cleanupByReference = async (db, referenceId) => {
  for (const collectionName of ['alerts', 'notifications']) {
    const snapshot = await db
      .collection(collectionName)
      .where('reference_id', '==', referenceId)
      .get();
    if (snapshot.empty) {
      continue;
    }
    const batch = db.batch();
    for (const document of snapshot.docs) {
      batch.delete(document.ref);
    }
    await batch.commit();
  }
};

describeFirestore('flujo manual con Firestore real y correo simulado', () => {
  beforeEach(() => {
    mockEmailSender.send.mockReset();
    mockEmailSender.send.mockImplementation(async ({ notificationId }) => ({
      provider_message_id: `test-${notificationId}`,
    }));
  });

  test('POST manual -> Firestore -> scheduler -> correo y PUT /acknowledgement', async () => {
    const container = createContainer(buildConfig());
    const referenceId = createReferenceId();

    try {
      const created = await request(container.app)
        .post('/notifications')
        .send(manualPayload(referenceId))
        .expect(201);

      expect(created.body).toMatchObject({
        delivery_status: DeliveryStatus.PENDING,
        alert_id: expect.any(String),
        notification_id: expect.any(String),
      });

      const alertSnapshot = await container.firestore.db
        .collection('alerts')
        .doc(created.body.alert_id)
        .get();
      expect(alertSnapshot.exists).toBe(true);
      expect(alertSnapshot.data()).toMatchObject({
        reference_id: referenceId,
        acknowledgement_status: AcknowledgementStatus.PENDING,
      });

      const notificationSnapshot = await container.firestore.db
        .collection('notifications')
        .doc(created.body.notification_id)
        .get();
      expect(notificationSnapshot.exists).toBe(true);
      expect(notificationSnapshot.data()).toMatchObject({
        reference_id: referenceId,
        delivery_status: DeliveryStatus.PENDING,
      });

      const second = buildSecondNotification(created.body.alert_id, referenceId);
      await createNotificationFirestoreRepository(container.firestore.db).createMany([second]);

      const dispatched = await container.scheduler.runOnce();
      expect(dispatched).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
      expect(mockEmailSender.send).toHaveBeenCalledTimes(1);
      expect(mockEmailSender.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@test.invalid',
          notificationId: created.body.notification_id,
        }),
      );

      const sentSnapshot = await container.firestore.db
        .collection('notifications')
        .doc(created.body.notification_id)
        .get();
      expect(sentSnapshot.data()).toMatchObject({
        delivery_status: DeliveryStatus.SENT,
        provider_message_id: `test-${created.body.notification_id}`,
      });
      expect(sentSnapshot.data().sent_at).toBeTruthy();

      const attended = await request(container.app)
        .put(`/notifications/${created.body.notification_id}/acknowledgement`)
        .expect(200);
      expect(attended.body).toMatchObject({
        notification_id: created.body.notification_id,
        alert_id: created.body.alert_id,
        acknowledgement_status: AcknowledgementStatus.ACKNOWLEDGED,
      });

      const attendedAlert = await container.firestore.db
        .collection('alerts')
        .doc(created.body.alert_id)
        .get();
      expect(attendedAlert.data().acknowledgement_status).toBe(AcknowledgementStatus.ACKNOWLEDGED);
      expect(attendedAlert.data().acknowledged_at).toBeTruthy();

      const notifications = await container.firestore.db
        .collection('notifications')
        .where('alert_id', '==', created.body.alert_id)
        .get();
      expect(notifications.size).toBe(2);
      for (const document of notifications.docs) {
        expect(document.data().acknowledgement_status).toBe(AcknowledgementStatus.ACKNOWLEDGED);
        expect(document.data().acknowledged_at).toBeTruthy();
      }
    } finally {
      await cleanupByReference(container.firestore.db, referenceId);
      await container.stop();
    }
  });

  test('reiniciar el contenedor no reenvía notificaciones SENT', async () => {
    const referenceId = createReferenceId();
    let firstContainer = createContainer(buildConfig());
    let secondContainer = null;

    try {
      const created = await request(firstContainer.app)
        .post('/notifications')
        .send(manualPayload(referenceId))
        .expect(201);

      const dispatched = await firstContainer.scheduler.runOnce();
      expect(dispatched).toMatchObject({ claimed: 1, sent: 1 });
      expect(mockEmailSender.send).toHaveBeenCalledTimes(1);

      await firstContainer.stop();
      firstContainer = null;

      mockEmailSender.send.mockClear();
      secondContainer = createContainer(buildConfig());

      const afterRestart = await secondContainer.scheduler.runOnce();
      expect(afterRestart).toMatchObject({ claimed: 0, sent: 0, failed: 0 });
      expect(mockEmailSender.send).not.toHaveBeenCalled();

      const stored = await secondContainer.firestore.db
        .collection('notifications')
        .doc(created.body.notification_id)
        .get();
      expect(stored.data().delivery_status).toBe(DeliveryStatus.SENT);
    } finally {
      const activeContainer = secondContainer ?? firstContainer;
      if (activeContainer) {
        await cleanupByReference(activeContainer.firestore.db, referenceId);
        await activeContainer.stop();
      }
    }
  });

  test('un fallo de correo no bloquea las demás notificaciones del lote', async () => {
    const container = createContainer(buildConfig());
    const referenceId = createReferenceId();

    try {
      const first = await request(container.app)
        .post('/notifications')
        .send(manualPayload(referenceId))
        .expect(201);
      const second = await request(container.app)
        .post('/notifications')
        .send(manualPayload(referenceId, { recipient_role: RecipientRole.MANAGEMENT }))
        .expect(201);

      mockEmailSender.send.mockImplementation(async ({ notificationId }) => {
        if (notificationId === first.body.notification_id) {
          throw new EmailDeliveryError('Destinatario inválido', {
            transient: false,
            code: 'EMAIL_INVALID',
          });
        }
        return { provider_message_id: `test-${notificationId}` };
      });

      const dispatched = await container.scheduler.runOnce();
      expect(dispatched).toMatchObject({ claimed: 2, sent: 1, failed: 1 });
      expect(mockEmailSender.send).toHaveBeenCalledTimes(2);

      const failed = await container.firestore.db
        .collection('notifications')
        .doc(first.body.notification_id)
        .get();
      expect(failed.data()).toMatchObject({
        delivery_status: DeliveryStatus.FAILED,
        failure_reason: 'EMAIL_INVALID',
        next_attempt_at: null,
      });

      const sent = await container.firestore.db
        .collection('notifications')
        .doc(second.body.notification_id)
        .get();
      expect(sent.data()).toMatchObject({
        delivery_status: DeliveryStatus.SENT,
        provider_message_id: `test-${second.body.notification_id}`,
      });
    } finally {
      await cleanupByReference(container.firestore.db, referenceId);
      await container.stop();
    }
  });
});
