const { config } = require('./config/env');
const { createContainer } = require('./config/composition-root');
const { shutdownResources } = require('./config/shutdown');
const { safeErrorFields } = require('./application/shared/safe-log-fields');

const main = async () => {
  const container = createContainer(config);
  const { logger } = container;
  let server;
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'Iniciando cierre ordenado');

    try {
      const ok = await shutdownResources({
        server,
        stop: () => container.stop(),
        logger,
        timeoutMs: config.health.shutdownTimeoutMs,
      });
      process.exit(ok ? 0 : 1);
    } catch (error) {
      logger.error(safeErrorFields(error), 'Fallo durante el cierre ordenado');
      process.exit(1);
    }
  };

  try {
    await container.start();
    server = container.app.listen(config.port, () => {
      logger.info({ port: config.port }, 'Servidor HTTP escuchando');
    });
    server.on('error', (error) => {
      logger.error(safeErrorFields(error), 'Error del servidor HTTP');
      void shutdown('SERVER_ERROR');
    });
  } catch (error) {
    logger.error(safeErrorFields(error), 'No fue posible iniciar el servicio');
    await container.stop().catch(() => {});
    process.exit(1);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
};

if (require.main === module) {
  main();
}

module.exports = { main };
