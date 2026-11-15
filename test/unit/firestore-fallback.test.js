const {
  MAX_FALLBACK_DOCUMENTS,
  buildFallbackLogFields,
  createNotificationFirestoreRepository,
} = require('../../src/adapters/out/firestore/notification.firestore.repository');

describe('fallback de listado', () => {
  test('limita el fallback a 500 documentos', () => {
    expect(MAX_FALLBACK_DOCUMENTS).toBe(500);
  });

  test('registra la combinación exacta de filtros que activó el fallback', () => {
    const dateFrom = new Date('2026-10-01T00:00:00.000Z');
    const fields = buildFallbackLogFields(
      {
        severity: 'CRITICAL',
        type: null,
        delivery_status: 'PENDING',
        reference_id: null,
        date_from: dateFrom,
      },
      0,
      100,
      { name: 'FailedPrecondition', code: 9 },
    );

    expect(fields).toEqual({
      fallback_limit: 500,
      page: 0,
      size: 100,
      filters: {
        severity: 'CRITICAL',
        delivery_status: 'PENDING',
        date_from: dateFrom,
      },
      error_name: 'FailedPrecondition',
      error_code: 9,
    });
  });

  test('registra el aviso al activar el fallback', async () => {
    const logger = { warn: jest.fn() };
    const collection = {
      where: jest.fn(() => collection),
      count: jest.fn(() => ({
        get: jest.fn().mockRejectedValue(
          Object.assign(new Error('missing index'), {
            name: 'FailedPrecondition',
            code: 9,
          }),
        ),
      })),
      orderBy: jest.fn(() => collection),
      limit: jest.fn(() => collection),
      get: jest.fn().mockResolvedValue({ docs: [] }),
    };
    const repository = createNotificationFirestoreRepository(
      { collection: jest.fn(() => collection) },
      null,
      logger,
    );

    await repository.search({
      filters: { severity: 'CRITICAL', delivery_status: 'PENDING' },
      page: 0,
      size: 100,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      {
        fallback_limit: 500,
        page: 0,
        size: 100,
        filters: { severity: 'CRITICAL', delivery_status: 'PENDING' },
        error_name: 'FailedPrecondition',
        error_code: 9,
      },
      expect.stringContaining('índice compuesto'),
    );
  });
});
