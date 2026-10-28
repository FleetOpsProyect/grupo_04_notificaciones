const maskEmail = (email) => {
  if (typeof email !== 'string') {
    return null;
  }
  const at = email.indexOf('@');
  if (at <= 0 || at === email.length - 1) {
    return null;
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const maskEmailsInText = (text) => {
  if (typeof text !== 'string') {
    return null;
  }
  return text.replace(EMAIL_PATTERN, (email) => maskEmail(email) ?? '[correo]');
};

module.exports = { maskEmail, maskEmailsInText };
