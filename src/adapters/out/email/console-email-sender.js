const { maskEmail } = require('../../../application/shared/mask-email');

const createConsoleEmailSender = ({ logger }) => ({
  async send({ to, subject, notificationId }) {
    logger?.info(
      {
        notification_id: notificationId,
        recipient: maskEmail(to),
        subject,
        provider: 'console',
      },
      'Correo simulado en consola',
    );
    return { provider_message_id: `local-${notificationId}` };
  },
});

module.exports = { createConsoleEmailSender };
