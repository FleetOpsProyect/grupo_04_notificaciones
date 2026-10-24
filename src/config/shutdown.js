const { safeErrorFields } = require('../application/shared/safe-log-fields');

const closeHttpServer = async (server) => {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const shutdownResources = async ({ server, stop, logger, timeoutMs }) => {
  const forceExit = setTimeout(() => {
    logger.error('Tiempo de cierre agotado; se fuerza la salida');
    process.exit(1);
  }, timeoutMs);
  forceExit.unref();

  const results = await Promise.allSettled([closeHttpServer(server), Promise.resolve().then(stop)]);
  clearTimeout(forceExit);

  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    failures.forEach((failure) => {
      logger.error(safeErrorFields(failure.reason), 'Fallo durante el cierre ordenado');
    });
    return false;
  }

  logger.info('Cierre ordenado completado');
  return true;
};

module.exports = { closeHttpServer, shutdownResources };
