jest.mock('../../src/config/env', () => ({
  config: {
    port: 3000,
    health: { shutdownTimeoutMs: 1000 },
  },
}));
jest.mock('../../src/config/composition-root', () => ({
  createContainer: jest.fn(),
}));
jest.mock('../../src/config/shutdown', () => ({
  shutdownResources: jest.fn(),
}));

const { main } = require('../../src/main');
const { createContainer } = require('../../src/config/composition-root');
const { shutdownResources } = require('../../src/config/shutdown');
const { config } = require('../../src/config/env');

const flush = () => new Promise((resolve) => setImmediate(resolve));

const buildContainer = (overrides = {}) => {
  const logger = { info: jest.fn(), error: jest.fn() };
  const server = { on: jest.fn() };
  const app = {
    listen: jest.fn((port, callback) => {
      callback();
      return server;
    }),
  };
  const container = {
    logger,
    app,
    start: jest.fn().mockResolvedValue(),
    stop: jest.fn().mockResolvedValue(),
    ...overrides,
  };
  return { container, logger, server, app };
};

describe('Ciclo de vida del proceso', () => {
  let handlers;
  let exit;

  beforeEach(() => {
    handlers = {};
    jest.spyOn(process, 'on').mockImplementation((signal, handler) => {
      handlers[signal] = handler;
      return process;
    });
    exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    shutdownResources.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test('arranca HTTP, registra señales y cierra con SIGTERM', async () => {
    const { container, logger, server, app } = buildContainer();
    createContainer.mockReturnValue(container);

    await main();

    expect(container.start).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalledWith(config.port, expect.any(Function));
    expect(server.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(handlers.SIGTERM).toEqual(expect.any(Function));
    expect(handlers.SIGINT).toEqual(expect.any(Function));

    handlers.SIGTERM();
    await flush();

    expect(shutdownResources).toHaveBeenCalledWith({
      server,
      stop: expect.any(Function),
      logger,
      timeoutMs: config.health.shutdownTimeoutMs,
    });
    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.info).toHaveBeenCalledWith({ signal: 'SIGTERM' }, 'Iniciando cierre ordenado');
  });

  test('cierra con SIGINT y no ejecuta el cierre dos veces', async () => {
    const { container } = buildContainer();
    createContainer.mockReturnValue(container);

    await main();

    handlers.SIGINT();
    handlers.SIGINT();
    await flush();

    expect(shutdownResources).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('sale con código 1 si el cierre ordenado falla', async () => {
    const { container, logger } = buildContainer();
    createContainer.mockReturnValue(container);
    shutdownResources.mockResolvedValue(false);

    await main();
    handlers.SIGTERM();
    await flush();

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.info).not.toHaveBeenCalledWith('Cierre ordenado completado');
  });

  test('sale con código 1 y registra el error si el cierre lanza', async () => {
    const { container, logger } = buildContainer();
    createContainer.mockReturnValue(container);
    shutdownResources.mockRejectedValue(new Error('fallo de cierre'));

    await main();
    handlers.SIGTERM();
    await flush();

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error_message: 'fallo de cierre' }),
      'Fallo durante el cierre ordenado',
    );
  });

  test('sale con código 1 si el arranque falla y detiene el contenedor', async () => {
    const { container, logger } = buildContainer({
      start: jest.fn().mockRejectedValue(new Error('firestore caído')),
    });
    createContainer.mockReturnValue(container);

    await main();

    expect(container.stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error_message: 'firestore caído' }),
      'No fue posible iniciar el servicio',
    );
  });

  test('un error del servidor HTTP dispara el cierre ordenado', async () => {
    const { container, server } = buildContainer();
    createContainer.mockReturnValue(container);

    await main();
    const onError = server.on.mock.calls.find(([event]) => event === 'error')[1];
    onError(new Error('puerto ocupado'));
    await flush();

    expect(shutdownResources).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
