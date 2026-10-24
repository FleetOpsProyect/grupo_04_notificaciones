const { randomUUID } = require('node:crypto');
const { runWithContext } = require('../../../../observability/request-context');

const correlationIdMiddleware = (req, res, next) => {
  const incoming = req.get('x-correlation-id');
  const correlationId =
    incoming && incoming.trim().length > 0 && incoming.length <= 128
      ? incoming.trim()
      : randomUUID();
  req.correlation_id = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  runWithContext({ correlation_id: correlationId }, next);
};

module.exports = { correlationIdMiddleware };
