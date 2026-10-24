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

module.exports = { maskEmail };
