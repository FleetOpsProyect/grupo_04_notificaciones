const http = require('node:http');
const { closeHttpServer, shutdownResources } = require('../../src/config/shutdown');

const logger = () => ({ info: jest.fn(), error: jest.fn() });

describe('Cierre ordenado', () => {
  test('closeHttpServer tolera un servidor inexistente', async () => {
    await expect(closeHttpServer(null)).resolves.toBeUndefined();
  });

  test('closeHttpServer cierra el servidor y tolera ERR_SERVER_NOT_RUNNING', async () => {
    const server = { close: jest.fn((callback) => callback()) };
    await expect(closeHttpServer(server)).resolves.toBeUndefined();
    expect(server.close).toHaveBeenCalledTimes(1);

    const notRunning = {
      close: jest.fn((callback) =>
        callback(Object.assign(new Error('no running'), { code: 'ERR_SERVER_NOT_RUNNING' })),
      ),
    };
    await expect(closeHttpServer(notRunning)).resolves.toBeUndefined();
  });

  test('closeHttpServer propaga errores reales', async () => {
    const server = { close: jest.fn((callback) => callback(new Error('close failed'))) };
    await expect(closeHttpServer(server)).rejects.toThrow('close failed');
  });

  test('cierra HTTP y detiene las dependencias en paralelo', async () => {
    const server = { close: jest.fn((callback) => callback()) };
    const stop = jest.fn().mockResolvedValue();
    const log = logger();

    await expect(shutdownResources({ server, stop, logger: log, timeoutMs: 1000 })).resolves.toBe(
      true,
    );

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('Cierre ordenado completado');
  });

  test('cierra un servidor HTTP real y deja de escuchar', async () => {
    const server = http.createServer((request, response) => response.end('ok'));
    await new Promise((resolve) => server.listen(0, resolve));
    expect(server.listening).toBe(true);

    await expect(
      shutdownResources({
        server,
        stop: jest.fn().mockResolvedValue(),
        logger: logger(),
        timeoutMs: 1000,
      }),
    ).resolves.toBe(true);

    expect(server.listening).toBe(false);
  });

  test('devuelve false y registra el fallo cuando una dependencia falla', async () => {
    const server = { close: jest.fn((callback) => callback()) };
    const stop = jest.fn().mockRejectedValue(new Error('kafka no cerró'));
    const log = logger();

    await expect(shutdownResources({ server, stop, logger: log, timeoutMs: 1000 })).resolves.toBe(
      false,
    );

    expect(stop).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ error_message: 'kafka no cerró' }),
      'Fallo durante el cierre ordenado',
    );
  });

  test('intenta cerrar todo aunque HTTP falle', async () => {
    const server = { close: jest.fn((callback) => callback(new Error('http no cerró'))) };
    const stop = jest.fn().mockResolvedValue();
    const log = logger();

    await expect(shutdownResources({ server, stop, logger: log, timeoutMs: 1000 })).resolves.toBe(
      false,
    );

    expect(stop).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalled();
  });

  test('fuerza la salida si el cierre excede el timeout', async () => {
    const server = { close: jest.fn((callback) => callback()) };
    let releaseStop;
    const stop = jest.fn(
      () =>
        new Promise((resolve) => {
          releaseStop = resolve;
        }),
    );
    const log = logger();
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});

    try {
      const closing = shutdownResources({ server, stop, logger: log, timeoutMs: 5 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(exit).toHaveBeenCalledWith(1);
      expect(log.error).toHaveBeenCalledWith('Tiempo de cierre agotado; se fuerza la salida');
      releaseStop();
      await expect(closing).resolves.toBe(true);
    } finally {
      exit.mockRestore();
    }
  });
});
