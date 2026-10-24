const client = require('prom-client');

const createMetrics = ({ registry = new client.Registry() } = {}) => {
  client.collectDefaultMetrics({ register: registry });

  const notificationsCreated = new client.Counter({
    name: 'notifications_created_total',
    help: 'Alertas creadas por tipo y severidad',
    labelNames: ['type', 'severity'],
    registers: [registry],
  });
  const dispatchTotal = new client.Counter({
    name: 'notification_dispatch_total',
    help: 'Resultado de los intentos de envío',
    labelNames: ['result'],
    registers: [registry],
  });
  const eventsProcessed = new client.Counter({
    name: 'events_processed_total',
    help: 'Eventos procesados por tipo y resultado',
    labelNames: ['event_type', 'result'],
    registers: [registry],
  });
  const dlqMessages = new client.Counter({
    name: 'dlq_messages_total',
    help: 'Mensajes enviados a la DLQ',
    labelNames: ['reason'],
    registers: [registry],
  });
  const circuitBreakerState = new client.Gauge({
    name: 'notification_circuit_breaker_state',
    help: 'Estado actual del Circuit Breaker de correo',
    labelNames: ['state'],
    registers: [registry],
  });
  const httpRequests = new client.Counter({
    name: 'http_requests_total',
    help: 'Peticiones HTTP por método, ruta y estado',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duración de peticiones HTTP',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const setCircuitBreakerState = (state) => {
    for (const value of ['closed', 'halfOpen', 'open']) {
      circuitBreakerState.set({ state: value }, value === state ? 1 : 0);
    }
  };

  const middleware = (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const route = req.route ? `${req.baseUrl}${req.route.path}` : 'UNKNOWN';
      const labels = { method: req.method, route, status: String(res.statusCode) };
      httpRequests.inc(labels);
      httpDuration.observe(labels, Number(process.hrtime.bigint() - started) / 1e9);
    });
    next();
  };

  return {
    registry,
    notificationsCreated,
    dispatchTotal,
    eventsProcessed,
    dlqMessages,
    circuitBreakerState,
    setCircuitBreakerState,
    middleware,
    contentType: registry.contentType,
    render: () => registry.metrics(),
  };
};

module.exports = { createMetrics };
