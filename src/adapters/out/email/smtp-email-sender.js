const nodemailer = require('nodemailer');
const { EmailDeliveryError } = require('../../../domain/errors');
const { maskEmailsInText } = require('../../../application/shared/mask-email');

const PERMANENT_ERROR_CODES = new Set([
  'EAUTH',
  'EENVELOPE',
  'EMESSAGE',
  'EPROTOCOL',
  'EACCES',
  '535',
  '534',
  '553',
]);

const TRANSIENT_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNECTION',
  'ESOCKET',
  'EAI_AGAIN',
  'ECONNRESET',
  'EDNS',
  'ENOTFOUND',
  '421',
  '450',
  '451',
  '452',
]);

const isDailyLimit = (error) => {
  const response = String(error?.response ?? '');
  return error?.responseCode === 550 && /5\.4\.5/.test(response);
};

const isTransientSmtpError = (error) => {
  if (isDailyLimit(error)) {
    return true;
  }
  const code = String(error?.code ?? '').toUpperCase();
  if (PERMANENT_ERROR_CODES.has(code)) {
    return false;
  }
  if (TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }
  const responseCode = Number(error?.responseCode);
  if (Number.isFinite(responseCode)) {
    if (responseCode >= 400 && responseCode < 500) {
      return true;
    }
    if (responseCode >= 500) {
      return false;
    }
  }
  return true;
};

const createSmtpEmailSender = ({
  transporter,
  transporterFactory = nodemailer.createTransport,
  host,
  port,
  secure = false,
  requireTls = true,
  user,
  pass,
  from,
  timeoutMs = 10000,
}) => {
  const transport =
    transporter ??
    transporterFactory({
      host,
      port,
      secure,
      requireTLS: requireTls,
      auth: { user, pass },
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
    });

  return {
    async send({ to, subject, text, notificationId }) {
      try {
        const info = await transport.sendMail({
          from,
          to,
          subject,
          text,
          headers: notificationId ? { 'X-Notification-Id': notificationId } : undefined,
        });
        if (!info?.messageId) {
          throw new EmailDeliveryError('SMTP no devolvió provider_message_id', {
            transient: true,
            code: 'EMAIL_DELIVERY_ERROR',
          });
        }
        return { provider_message_id: info.messageId };
      } catch (error) {
        if (error instanceof EmailDeliveryError) {
          throw error;
        }
        const transient = isTransientSmtpError(error);
        const code = String(error?.code ?? 'EMAIL_DELIVERY_ERROR').toUpperCase();
        throw new EmailDeliveryError(
          maskEmailsInText(error?.message) || 'No fue posible enviar el correo por SMTP',
          {
            transient,
            code,
          },
        );
      }
    },
  };
};

module.exports = {
  createSmtpEmailSender,
  isTransientSmtpError,
  PERMANENT_ERROR_CODES,
  TRANSIENT_ERROR_CODES,
};
