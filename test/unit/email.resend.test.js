const http = require('node:http');
const {
  createResendEmailSender,
  isTransientStatus,
} = require('../../src/adapters/out/email/resend-email-sender');

const listen = async (handler) => {
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => handler(request, response, body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const respond = (response, statusCode, payload) => {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
};

const message = {
  to: 'destinatario@example.com',
  subject: 'Asunto de prueba',
  text: 'Cuerpo del correo',
  notificationId: 'notif-1',
};

describe('Adaptador Resend', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('envía con idempotencyKey y devuelve el provider_message_id', async () => {
    const captured = {};
    const { server, baseUrl } = await listen((request, response, body) => {
      captured.method = request.method;
      captured.url = request.url;
      captured.headers = request.headers;
      captured.body = body;
      respond(response, 200, { id: 're_123' });
    });

    try {
      const sender = createResendEmailSender({
        apiKey: 're_test',
        from: 'no-reply@test.dev',
        baseUrl,
      });

      await expect(sender.send(message)).resolves.toEqual({
        provider_message_id: 're_123',
      });
      expect(captured.method).toBe('POST');
      expect(captured.url).toBe('/emails');
      expect(captured.headers.authorization).toBe('Bearer re_test');
      expect(captured.headers['idempotency-key']).toBe(message.notificationId);
      expect(captured.headers['content-type']).toContain('application/json');
      expect(JSON.parse(captured.body)).toMatchObject({
        from: 'no-reply@test.dev',
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } finally {
      await close(server);
    }
  });

  test.each([
    [429, 'rate_limit_exceeded', true],
    [500, 'internal_server_error', true],
    [503, 'service_unavailable', true],
    [400, 'validation_error', false],
    [422, 'invalid_recipient', false],
  ])('mapea HTTP %i (%s) como transitorio=%s', async (statusCode, name, transient) => {
    const { server, baseUrl } = await listen((request, response) => {
      respond(response, statusCode, {
        statusCode,
        name,
        message: 'Error controlado de Resend',
      });
    });

    try {
      const sender = createResendEmailSender({
        apiKey: 're_test',
        from: 'no-reply@test.dev',
        baseUrl,
      });
      await expect(sender.send(message)).rejects.toMatchObject({
        transient,
        code: name.toUpperCase(),
      });
    } finally {
      await close(server);
    }
  });

  test('enmascara correos dentro del mensaje de error de Resend', async () => {
    const { server, baseUrl } = await listen((request, response) => {
      respond(response, 422, {
        statusCode: 422,
        name: 'validation_error',
        message: 'El destinatario destinatario@example.com no es válido',
      });
    });

    try {
      const sender = createResendEmailSender({
        apiKey: 're_test',
        from: 'no-reply@test.dev',
        baseUrl,
      });
      const error = await sender.send(message).catch((caught) => caught);
      expect(error.message).not.toContain('destinatario@example.com');
      expect(error.message).toContain('d***@example.com');
      expect(error.transient).toBe(false);
    } finally {
      await close(server);
    }
  });

  test('marca como transitoria la ausencia de provider_message_id', async () => {
    const { server, baseUrl } = await listen((request, response) => {
      respond(response, 200, {});
    });

    try {
      const sender = createResendEmailSender({
        apiKey: 're_test',
        from: 'no-reply@test.dev',
        baseUrl,
      });
      await expect(sender.send(message)).rejects.toMatchObject({
        transient: true,
        code: 'EMAIL_DELIVERY_ERROR',
      });
    } finally {
      await close(server);
    }
  });

  test('marca como transitorio un error de red', async () => {
    const { server, baseUrl } = await listen((request, response) => {
      respond(response, 200, { id: 'unused' });
    });
    await close(server);

    const sender = createResendEmailSender({
      apiKey: 're_test',
      from: 'no-reply@test.dev',
      baseUrl,
    });

    await expect(sender.send(message)).rejects.toMatchObject({
      transient: true,
      code: 'EMAIL_PROVIDER_UNAVAILABLE',
    });
  });

  test('clasifica códigos HTTP transitorios y permanentes', () => {
    expect(isTransientStatus(429)).toBe(true);
    expect(isTransientStatus(500)).toBe(true);
    expect(isTransientStatus(503)).toBe(true);
    expect(isTransientStatus(undefined)).toBe(true);
    expect(isTransientStatus(null)).toBe(true);
    expect(isTransientStatus(400)).toBe(false);
    expect(isTransientStatus(422)).toBe(false);
  });
});
