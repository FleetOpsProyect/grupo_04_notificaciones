const { Resend } = require('resend');
const { EmailDeliveryError } = require('../../../domain/errors');
const { maskEmailsInText } = require('../../../application/shared/mask-email');

const isTransientStatus = (statusCode) =>
  statusCode === null || statusCode === undefined || statusCode === 429 || statusCode >= 500;

const createResendEmailSender = ({ apiKey, from, baseUrl }) => {
  const resend = new Resend(apiKey, baseUrl ? { baseUrl } : undefined);

  return {
    async send({ to, subject, text, notificationId }) {
      try {
        const { data, error } = await resend.emails.send(
          { from, to, subject, text },
          { idempotencyKey: notificationId },
        );
        if (error) {
          const statusCode = error.statusCode;
          const providerUnavailable = statusCode === null || statusCode === undefined;
          throw new EmailDeliveryError(maskEmailsInText(error.message) || 'Error de Resend', {
            transient: isTransientStatus(statusCode),
            code: providerUnavailable
              ? 'EMAIL_PROVIDER_UNAVAILABLE'
              : error.name?.toUpperCase() || 'EMAIL_DELIVERY_ERROR',
          });
        }
        if (!data?.id) {
          throw new EmailDeliveryError('Resend no devolvió provider_message_id', {
            transient: true,
          });
        }
        return { provider_message_id: data.id };
      } catch (error) {
        if (error instanceof EmailDeliveryError) {
          throw error;
        }
        throw new EmailDeliveryError('No fue posible contactar a Resend', {
          transient: true,
          code: 'EMAIL_PROVIDER_UNAVAILABLE',
        });
      }
    },
  };
};

module.exports = { createResendEmailSender, isTransientStatus };
