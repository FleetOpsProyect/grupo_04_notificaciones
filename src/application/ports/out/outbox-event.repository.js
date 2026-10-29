/**
 * OutboxEventRepository: create(record), claimBatch(now, limit, leaseMs),
 * markPublished(eventId, publishedAt), markFailed(eventId, nextAttemptAt, attempts).
 * Se usa dentro de la transacción de negocio para eventos propios.
 */
module.exports = {};
