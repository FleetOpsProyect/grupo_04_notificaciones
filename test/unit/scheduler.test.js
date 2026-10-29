const { createDispatchScheduler } = require('../../src/adapters/in/scheduler/dispatch.scheduler');

describe('DispatchScheduler', () => {
  test('ejecuta un ciclo y registra el resultado', async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const dispatchPending = jest.fn().mockResolvedValue({
      claimed: 2,
      sent: 2,
      failed: 0,
      retried: 0,
      skipped: 0,
      circuit_open: 0,
    });
    const scheduler = createDispatchScheduler({
      dispatchPending,
      intervalMs: 1000,
      logger,
    });
    await expect(scheduler.runOnce()).resolves.toMatchObject({ claimed: 2 });
    expect(logger.info).toHaveBeenCalled();
  });

  test('no solapa ciclos y captura errores', async () => {
    let resolveFirst;
    const dispatchPending = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({ claimed: 1 });
    const logger = { info: jest.fn(), error: jest.fn() };
    const scheduler = createDispatchScheduler({
      dispatchPending,
      intervalMs: 1000,
      logger,
    });
    const first = scheduler.runOnce();
    await Promise.resolve();
    const second = scheduler.runOnce();
    resolveFirst({ claimed: 0 });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toMatchObject({ claimed: 0 });
    expect(secondResult).toMatchObject({ claimed: 0 });

    dispatchPending.mockRejectedValueOnce(new Error('fallo'));
    await expect(scheduler.runOnce()).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  test('inicia y detiene el temporizador', async () => {
    jest.useFakeTimers();
    const dispatchPending = jest.fn().mockResolvedValue({ claimed: 0 });
    const scheduler = createDispatchScheduler({
      dispatchPending,
      intervalMs: 1000,
      logger: { info: jest.fn(), error: jest.fn() },
    });
    scheduler.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(dispatchPending).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(dispatchPending).toHaveBeenCalledTimes(2);
    scheduler.start();
    await scheduler.stop();
    await jest.advanceTimersByTimeAsync(3000);
    expect(dispatchPending).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

describe('OutboxScheduler', () => {
  const { createOutboxScheduler } = require('../../src/adapters/in/scheduler/outbox.scheduler');

  test('ejecuta un ciclo y registra el resultado', async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const publishOutbox = jest.fn().mockResolvedValue({
      claimed: 3,
      published: 3,
      failed: 0,
      skipped: false,
    });
    const scheduler = createOutboxScheduler({ publishOutbox, intervalMs: 2000, logger });
    await expect(scheduler.runOnce()).resolves.toMatchObject({ published: 3 });
    expect(logger.info).toHaveBeenCalled();
  });

  test('captura errores y se detiene sin solapar', async () => {
    let resolveFirst;
    const publishOutbox = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('fallo'));
    const logger = { info: jest.fn(), error: jest.fn() };
    const scheduler = createOutboxScheduler({ publishOutbox, intervalMs: 2000, logger });
    const first = scheduler.runOnce();
    await Promise.resolve();
    const second = scheduler.runOnce();
    resolveFirst({ claimed: 0 });
    await Promise.all([first, second]);
    await expect(scheduler.runOnce()).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalled();
    await scheduler.stop();
  });
});
