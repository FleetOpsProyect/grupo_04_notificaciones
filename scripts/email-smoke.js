const { config } = require('../src/config/env');
const { createSmtpEmailSender } = require('../src/adapters/out/email/smtp-email-sender');
const { maskEmail } = require('../src/application/shared/mask-email');
const { safeErrorFields } = require('../src/application/shared/safe-log-fields');

const recipient = process.argv[2];

if (!recipient) {
  process.stderr.write('Uso: npm run email:smoke -- destino@example.com\n');
  process.exitCode = 1;
} else if (config.email.provider !== 'smtp') {
  process.stderr.write('EMAIL_PROVIDER debe ser smtp para ejecutar el smoke.\n');
  process.exitCode = 1;
} else {
  const main = async () => {
    const sender = createSmtpEmailSender({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.secure,
      requireTls: config.email.smtp.requireTls,
      user: config.email.smtp.user,
      pass: config.email.smtp.password,
      from: config.email.from,
      timeoutMs: config.email.timeoutMs,
    });
    const notificationId = `smoke-${Date.now()}`;
    const result = await sender.send({
      to: recipient,
      subject: '[FleetOps] Prueba de correo SMTP',
      text: 'Este es un correo de prueba del microservicio de Notificaciones. Si lo recibiste, el proveedor SMTP funciona.',
      notificationId,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'sent',
          provider: 'smtp',
          recipient: maskEmail(recipient),
          provider_message_id: result.provider_message_id,
          notification_id: notificationId,
        },
        null,
        2,
      )}\n`,
    );
  };

  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify(
        {
          status: 'failed',
          provider: 'smtp',
          ...safeErrorFields(error),
          transient: error?.transient ?? null,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  });
}
