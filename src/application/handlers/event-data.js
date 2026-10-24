const { InvalidDataError } = require('../../domain/errors');

const parseEventData = (schema, data, eventType) => {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  const errors = result.error.issues.map((issue) => ({
    campo: issue.path.length > 0 ? issue.path.join('.') : 'datos',
    codigo: issue.code,
  }));
  throw new InvalidDataError(`Datos inválidos para ${eventType}`, errors);
};

module.exports = { parseEventData };
