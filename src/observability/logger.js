const pino = require('pino');
const { getCorrelationId } = require('./request-context');

const createLogger = ({ level = 'info', serviceName = 'notification' } = {}) =>
  pino({
    level,
    base: { service: serviceName },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'recipient_email',
        '*.recipient_email',
        'req.headers.authorization',
        'authorization',
        'apiKey',
        '*.apiKey',
      ],
      censor: '[REDACTED]',
    },
    mixin() {
      const correlationId = getCorrelationId();
      return correlationId ? { correlation_id: correlationId } : {};
    },
  });

module.exports = { createLogger };
