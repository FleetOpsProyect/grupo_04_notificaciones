const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { InvalidDataError } = require('../../../domain/errors');

const eventEnvelopeSchema = z.object({
  evento_id: z.string().uuid(),
  tipo_evento: z.string().min(1),
  version: z.union([z.literal(1), z.literal('1'), z.literal('1.0')]).optional(),
  fecha_evento: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'fecha_evento debe ser ISO 8601',
  }),
  origen: z.string().min(1),
  correlation_id: z.string().min(1).optional(),
  datos: z.object({}).passthrough(),
});

const parseEventEnvelope = (rawValue) => {
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

  return {
    ...result.data,
    correlation_id: result.data.correlation_id ?? randomUUID(),
  };
};

module.exports = { eventEnvelopeSchema, parseEventEnvelope };
