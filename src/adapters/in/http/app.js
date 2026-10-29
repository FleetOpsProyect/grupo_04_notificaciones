const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');
const { correlationIdMiddleware } = require('./middleware/correlation-id');
const { createNotificationRouter } = require('./routes/notification.routes');
const { errorHandler, notFoundHandler } = require('./errors/error-handler');

const createApp = ({
  notificationController,
  readiness,
  metrics,
  logger,
  enableSwagger = false,
  openapiDocument = null,
}) => {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(correlationIdMiddleware);
  if (logger) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => req.correlation_id,
        quietReqLogger: true,
      }),
    );
  }
  app.use(metrics.middleware);

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP' });
  });

  app.get('/ready', async (req, res) => {
    const result = await readiness();
    res.status(result.statusCode).json(result.body);
  });

  app.get('/metrics', async (req, res) => {
    res.setHeader('Content-Type', metrics.contentType);
    res.status(200).send(await metrics.render());
  });

  if (enableSwagger && openapiDocument) {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));
  }

  app.use(express.json({ limit: '100kb' }));
  app.use('/notifications', createNotificationRouter(notificationController));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
};

module.exports = { createApp };
