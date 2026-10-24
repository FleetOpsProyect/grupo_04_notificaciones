const { InvalidDataError } = require('../errors');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeRecipientEmail = (value) => {
  if (typeof value !== 'string') {
    throw new InvalidDataError('recipient_email debe ser texto');
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    throw new InvalidDataError('recipient_email no tiene un formato válido');
  }
  return normalized;
};

const isValidRecipientEmail = (value) => {
  try {
    normalizeRecipientEmail(value);
    return true;
  } catch {
    return false;
  }
};

module.exports = { normalizeRecipientEmail, isValidRecipientEmail };
