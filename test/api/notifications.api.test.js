const request = require('supertest');
const { createApp } = require('../../src/adapters/in/http/app');
const {
  createNotificationController,
} = require('../../src/adapters/in/http/controllers/notification.controller');
const { createTestContext, eventEnvelope } = require('../helpers/test-context');

const manualBody = {
  type: 'GENERAL',
  severity: 'INFO',
  recipient_role: 'MANAGEMENT',
  message: 'Mensaje manual de prueba',
  reference_id: 'REF-1',
};

const fakeMetrics = () => ({
  middleware: (req, res, next) => next(),
  contentType: 'text/plain; version=0.0.4',
  render: async () => 'notifications_created_total 3\n',
});

const buildApp = (context, readinessStatus = 200) => {
  const controller = createNotificationController(context.useCases);
  return createApp({
    notificationController: controller,
    readiness: async () => ({
      statusCode: readinessStatus,
      body: {
        status: readinessStatus === 200 ? 'READY' : 'NOT_READY',
        checks: { database: { status: readinessStatus === 200 ? 'UP' : 'DOWN' } },
      },
    }),
    metrics: fakeMetrics(),
    logger: null,
    enableSwagger: false,
  });
};

describe('HTTP API de notificaciones', () => {
  test('POST crea una notificación con Location y correlation id', async () => {
    const context = createTestContext();
    const app = buildApp(context);
    const response = await request(app)
      .post('/notifications')
      .set('x-correlation-id', 'corr-http')
      .send({ ...manualBody, campo_desconocido: 'ignorado' });

    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`/notifications/${response.body.notification_id}`);
    expect(response.headers['x-correlation-id']).toBe('corr-http');
    expect(response.body).toMatchObject({
      delivery_status: 'PENDING',
    });
    expect(context.state.notifications.size).toBe(1);
  });

  test('POST rechaza datos inválidos y JSON malformado', async () => {
    const context = createTestContext();
    const app = buildApp(context);
    const invalid = await request(app)
      .post('/notifications')
      .send({ ...manualBody, severity: 'OTRO' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.codigo).toBe('INVALID_DATA');
    expect(invalid.body.errores[0].campo).toBe('severity');

    const employee = await request(app)
      .post('/notifications')
      .send({ ...manualBody, recipient_role: 'EMPLOYEE' });
    expect(employee.status).toBe(400);

    const malformed = await request(app)
      .post('/notifications')
      .set('Content-Type', 'application/json')
      .send('{"type":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.codigo).toBe('MALFORMED_JSON');
  });

  test('GET /status devuelve conteos agregados', async () => {
    const context = createTestContext();
    await context.useCases.processDomainEvent(eventEnvelope());
    const app = buildApp(context);
    const response = await request(app).get('/notifications/status');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      critical_alerts_pending: 1,
      total_notifications: 2,
      deliveries: { pending: 2, sent: 0, failed: 0 },
    });
  });

  test('GET lista, filtra y valida parámetros', async () => {
    const context = createTestContext();
    await request(buildApp(context)).post('/notifications').send(manualBody);
    await context.useCases.processDomainEvent(eventEnvelope());
    const app = buildApp(context);

    const listed = await request(app)
      .get('/notifications')
      .query({ severity: 'CRITICAL', page: 0, size: 1 });
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(2);
    expect(listed.body.content).toHaveLength(1);
    expect(listed.body.summary.by_severity.CRITICAL).toBe(2);

    const invalid = await request(app).get('/notifications?size=500');
    expect(invalid.status).toBe(400);
    expect(invalid.body.codigo).toBe('INVALID_PARAMETERS');
  });

  test('GET por id enmascara el correo y valida el UUID', async () => {
    const context = createTestContext();
    const processed = await context.useCases.processDomainEvent(
      eventEnvelope({
        event_type: 'interrupted_assignment_event',
        data: {
          assignment_id: 'ASG-1',
          employee_email: 'empleado@example.com',
          reassignment_result: 'MANUAL_REQUIRED',
        },
      }),
    );
    const app = buildApp(context);
    const response = await request(app).get(`/notifications/${processed.notification_ids[0]}`);
    expect(response.status).toBe(200);
    expect(response.body.recipient_email).toBe('e***@example.com');

    const invalid = await request(app).get('/notifications/no-es-uuid');
    expect(invalid.status).toBe(400);
    expect(invalid.body.codigo).toBe('INVALID_PARAMETERS');

    const missing = await request(app).get('/notifications/00000000-0000-4000-8000-000000000099');
    expect(missing.status).toBe(404);
    expect(missing.body.codigo).toBe('NOTIFICATION_NOT_FOUND');
  });

  test('PUT acknowledgement es idempotente', async () => {
    const context = createTestContext();
    const created = await request(buildApp(context)).post('/notifications').send(manualBody);
    const app = buildApp(context);
    const first = await request(app).put(
      `/notifications/${created.body.notification_id}/acknowledgement`,
    );
    expect(first.status).toBe(200);
    expect(first.body.acknowledgement_status).toBe('ACKNOWLEDGED');
    const second = await request(app).put(
      `/notifications/${created.body.notification_id}/acknowledgement`,
    );
    expect(second.status).toBe(200);
    expect(second.body.acknowledged_at).toBe(first.body.acknowledged_at);
  });

  test('expone health, readiness, metrics y 404', async () => {
    const app = buildApp(createTestContext());
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('UP');

    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('READY');

    const metrics = await request(app).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('notifications_created_total');

    const missing = await request(app).get('/ruta-inexistente');
    expect(missing.status).toBe(404);
    expect(missing.body.codigo).toBe('NOT_FOUND');
  });

  test('readiness responde 503 cuando Firestore no está disponible', async () => {
    const app = buildApp(createTestContext(), 503);
    const response = await request(app).get('/ready');
    expect(response.status).toBe(503);
    expect(response.body.status).toBe('NOT_READY');
  });
});
