const { safeErrorFields } = require('../../../application/shared/safe-log-fields');

const createOutboxScheduler = ({ publishOutbox, intervalMs, logger }) => {
  let timer = null;
  let running = false;
  let currentRun = null;

  const tick = async () => {
    if (running) {
      return null;
    }
    running = true;
    currentRun = (async () => {
      try {
        const result = await publishOutbox();
        if (result.claimed > 0) {
          logger?.info(result, 'Ciclo de publicación de outbox completado');
        }
        return result;
      } catch (error) {
        logger?.error(safeErrorFields(error), 'Fallo el ciclo de publicación de outbox');
        return null;
      } finally {
        running = false;
      }
    })();
    return currentRun;
  };

  return {
    start() {
      if (timer !== null) {
        return;
      }
      void tick();
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
    },
    async runOnce() {
      const result = await tick();
      if (result === null && currentRun) {
        return currentRun;
      }
      return result;
    },
    async stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (currentRun) {
        await currentRun;
      }
    },
  };
};

module.exports = { createOutboxScheduler };
