const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { InvalidDataError } = require('../../../domain/errors');

const eventEnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.string().min(1),
  version: z.union([z.number(), z.string()]).optional(),
  occurred_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'occurred_at debe ser ISO 8601',
  }),
  source: z.string().min(1),
  correlation_id: z.string().min(1).optional(),
  data: z.object({}).passthrough(),
});

const parseEventEnvelope = (rawValue, { attributeEventType = null } = {}) => {
  let parsed;
  try {
    parsed = JSON.parse(rawValue.toString('utf8'));
  } catch {
    throw new InvalidDataError('El evento no contiene JSON válido');
  }

  const result = eventEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    throw new InvalidDataError(
      'Sobre de evento inválido',
      result.error.issues.map((issue) => ({
        campo: issue.path.join('.') || 'evento',
        codigo: issue.code,
      })),
    );
  }

  if (attributeEventType && attributeEventType !== result.data.event_type) {
    throw new InvalidDataError('event_type del atributo no coincide con el del sobre', [
      { campo: 'event_type', codigo: 'MISMATCH' },
    ]);
  }

  return {
    ...result.data,
    correlation_id: result.data.correlation_id ?? randomUUID(),
  };
};

module.exports = { eventEnvelopeSchema, parseEventEnvelope };
