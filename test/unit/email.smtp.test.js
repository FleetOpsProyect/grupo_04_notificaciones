const {
  createSmtpEmailSender,
  isTransientSmtpError,
} = require('../../src/adapters/out/email/smtp-email-sender');

const message = {
  to: 'destinatario@example.com',
  subject: 'Asunto de prueba',
  text: 'Cuerpo del correo',
  notificationId: 'notif-1',
};

const createSender = (sendMail) =>
  createSmtpEmailSender({
    transporter: { sendMail },
    from: 'fleetops.notificaciones@gmail.com',
    timeoutMs: 10000,
  });

describe('Adaptador SMTP', () => {
  test('envía el correo y devuelve el provider_message_id', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<msg-1@example.com>' });
    const sender = createSender(sendMail);

    await expect(sender.send(message)).resolves.toEqual({
      provider_message_id: '<msg-1@example.com>',
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'fleetops.notificaciones@gmail.com',
      to: message.to,
      subject: message.subject,
      text: message.text,
      headers: { 'X-Notification-Id': message.notificationId },
    });
  });

  test('marca como transitoria la ausencia de provider_message_id', async () => {
    const sender = createSender(jest.fn().mockResolvedValue({}));

    await expect(sender.send(message)).rejects.toMatchObject({
      transient: true,
      code: 'EMAIL_DELIVERY_ERROR',
    });
  });

  test.each([
    [{ code: 'EAUTH', responseCode: 535, message: 'Invalid login' }, false],
    [{ code: 'EENVELOPE', responseCode: 550, message: 'Mailbox unavailable' }, false],
    [{ code: 'ETIMEDOUT', message: 'Connection timeout' }, true],
    [{ code: 'ECONNECTION', message: 'Connection refused' }, true],
    [{ responseCode: 421, message: 'Service not available' }, true],
    [{ responseCode: 450, message: 'Mailbox busy' }, true],
    [{ responseCode: 550, response: '550 5.1.1 User unknown' }, false],
    [{ responseCode: 550, response: '550 5.4.5 Daily user sending limit exceeded' }, true],
  ])('clasifica el error %j como transitorio=%s', async (providerError, transient) => {
    const error = Object.assign(new Error(providerError.message ?? 'SMTP error'), providerError);
    const sender = createSender(jest.fn().mockRejectedValue(error));

    await expect(sender.send(message)).rejects.toMatchObject({ transient });
  });

  test('enmascara correos en el mensaje de error', async () => {
    const error = Object.assign(
      new Error('El destinatario destinatario@example.com no es válido'),
      { code: 'EENVELOPE', responseCode: 550 },
    );
    const sender = createSender(jest.fn().mockRejectedValue(error));

    const caught = await sender.send(message).catch((value) => value);
    expect(caught.message).not.toContain('destinatario@example.com');
    expect(caught.message).toContain('d***@example.com');
    expect(caught.transient).toBe(false);
  });

  test('clasifica códigos SMTP transitorios y permanentes', () => {
    expect(isTransientSmtpError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTransientSmtpError({ responseCode: 421 })).toBe(true);
    expect(isTransientSmtpError({ responseCode: 450 })).toBe(true);
    expect(isTransientSmtpError({ code: 'EAUTH' })).toBe(false);
    expect(isTransientSmtpError({ responseCode: 550 })).toBe(false);
    expect(
      isTransientSmtpError({
        responseCode: 550,
        response: '550 5.4.5 Daily user sending limit exceeded',
      }),
    ).toBe(true);
  });
});
