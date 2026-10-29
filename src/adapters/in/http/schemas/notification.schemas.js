const { z } = require('zod');
const {
  ACKNOWLEDGEMENT_STATUS_VALUES,
  DELIVERY_STATUS_VALUES,
  SEVERITY_VALUES,
  TYPE_VALUES,
} = require('../../../../domain/enums');
const { InvalidDataError, InvalidParametersError } = require('../../../../domain/errors');

const manualNotificationSchema = z.object({
  type: z.enum(TYPE_VALUES),
  severity: z.enum(SEVERITY_VALUES),
  recipient_role: z.enum(['FLEET_ADMINISTRATOR', 'MAINTENANCE_TECHNICIAN', 'MANAGEMENT']),
  message: z.string().trim().min(1).max(500),
  reference_id: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^\S+$/, 'reference_id no debe contener espacios')
    .optional(),
});

const notificationIdSchema = z.object({
  id: z.string().uuid(),
});

const dateFilter = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'La fecha no es válida');

const listQuerySchema = z.object({
  recipient_role: z
    .enum(['FLEET_ADMINISTRATOR', 'MAINTENANCE_TECHNICIAN', 'MANAGEMENT', 'EMPLOYEE'])
    .optional(),
  type: z.enum(TYPE_VALUES).optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  delivery_status: z.enum(DELIVERY_STATUS_VALUES).optional(),
  acknowledgement_status: z.enum(ACKNOWLEDGEMENT_STATUS_VALUES).optional(),
  reference_id: z.string().trim().min(1).max(50).optional(),
  date_from: dateFilter.optional(),
  date_to: dateFilter.optional(),
  page: z.preprocess(
    (value) => (value === undefined || value === '' ? 0 : Number(value)),
    z.number().int().min(0),
  ),
  size: z.preprocess(
    (value) => (value === undefined || value === '' ? 20 : Number(value)),
    z.number().int().min(1).max(100),
  ),
});

const issuesToErrors = (error) =>
  error.issues.map((issue) => ({
    campo: issue.path.length > 0 ? issue.path.join('.') : 'body',
    codigo: issue.code,
  }));

const parseInput = (schema, value, { ErrorClass = InvalidDataError, message } = {}) => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ErrorClass(message ?? 'Datos inválidos', issuesToErrors(result.error));
  }
  return result.data;
};

const parseBody = (schema, value, message = 'Datos inválidos') =>
  parseInput(schema, value, { ErrorClass: InvalidDataError, message });

const parseParameters = (schema, value, message = 'Parámetros inválidos') =>
  parseInput(schema, value, { ErrorClass: InvalidParametersError, message });

module.exports = {
  manualNotificationSchema,
  notificationIdSchema,
  listQuerySchema,
  parseBody,
  parseParameters,
};
