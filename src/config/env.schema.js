const { z } = require('zod');

const csv = (value) =>
  String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const boolean = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  return String(value).toLowerCase() === 'true' || String(value) === '1';
}, z.boolean());

const integer = (defaultValue, min = 0) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? defaultValue : Number(value)),
    z.number().int().min(min),
  );

const email = z.string().trim().email();
const optionalEmail = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.string().trim().email().nullable(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: integer(3000, 1),
    SERVICE_NAME: z.string().trim().min(1).default('notification'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TZ: z.string().trim().default('America/Bogota'),
    ENABLE_SWAGGER: boolean.default(true),

    FIREBASE_PROJECT_ID: z.string().trim().min(1).default('demo-fleetops'),
    GOOGLE_APPLICATION_CREDENTIALS: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().optional(),
    ),
    FIRESTORE_EMULATOR_HOST: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().optional(),
    ),

    KAFKA_ENABLED: boolean.default(false),
    KAFKA_BROKERS: z.string().trim().default('127.0.0.1:9092'),
    KAFKA_CLIENT_ID: z.string().trim().min(1).default('notification-service'),
    KAFKA_GROUP_ID: z.string().trim().min(1).default('notification-service'),
    KAFKA_SSL: boolean.default(false),
    KAFKA_SASL_MECHANISM: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().optional(),
    ),
    KAFKA_SASL_USERNAME: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().optional(),
    ),
    KAFKA_SASL_PASSWORD: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional(),
    ),
    KAFKA_TOPIC_INCIDENT: z.string().trim().min(1).default('fleetops.incident.incident.v1'),
    KAFKA_TOPIC_ASSIGNMENT: z.string().trim().min(1).default('fleetops.assignment.assignment.v1'),
    KAFKA_TOPIC_DOCUMENT: z.string().trim().min(1).default('fleetops.document.document.v1'),
    KAFKA_TOPIC_MAINTENANCE: z
      .string()
      .trim()
      .min(1)
      .default('fleetops.maintenance.maintenance.v1'),
    KAFKA_TOPIC_FUEL: z.string().trim().min(1).default('fleetops.fuel.consumption.v1'),
    KAFKA_DLQ_TOPIC: z.string().trim().min(1).default('fleetops.dlq.notification'),

    EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    RESEND_API_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().optional(),
    ),
    EMAIL_FROM: email.default('notificaciones@example.invalid'),
    EMAIL_TIMEOUT_MS: integer(5000, 1),
    EMAIL_RETRY_DELAYS_MS: z.string().default('30000,120000,600000'),
    EMAIL_MAX_ATTEMPTS: integer(4, 1),
    EMAIL_CB_THRESHOLD: integer(5, 1),
    EMAIL_CB_RESET_MS: integer(30000, 1),

    DISPATCH_INTERVAL_MS: integer(10000, 1),
    DISPATCH_BATCH_SIZE: integer(20, 1),
    DISPATCH_LEASE_MS: integer(60000, 1),

    CONSUMER_RETRY_DELAYS_MS: z.string().default('2000,10000,30000'),
    CONSUMER_HEARTBEAT_MS: integer(3000, 1),

    RECIPIENT_FLEET_ADMINISTRATOR: email.default('admin@example.invalid'),
    RECIPIENT_MAINTENANCE_TECHNICIAN: email.default('tecnico@example.invalid'),
    RECIPIENT_MANAGEMENT: optionalEmail.default('gerencia@example.invalid'),

    READINESS_TIMEOUT_MS: integer(3000, 1),
    SHUTDOWN_TIMEOUT_MS: integer(10000, 1),
  })
  .superRefine((value, context) => {
    if (value.EMAIL_PROVIDER === 'resend' && !value.RESEND_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY es obligatoria cuando EMAIL_PROVIDER=resend',
      });
    }
    if (value.KAFKA_SASL_MECHANISM && (!value.KAFKA_SASL_USERNAME || !value.KAFKA_SASL_PASSWORD)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KAFKA_SASL_USERNAME'],
        message: 'KAFKA_SASL_USERNAME y KAFKA_SASL_PASSWORD son obligatorios con SASL',
      });
    }
  });

const loadConfig = (environment = process.env) => {
  const parsed = envSchema.safeParse(environment);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({
      campo: issue.path.join('.') || 'env',
      codigo: issue.code,
    }));
    const error = new Error('Configuración de entorno inválida');
    error.name = 'EnvironmentValidationError';
    error.errors = errors;
    throw error;
  }

  const value = parsed.data;
  const retryDelays = csv(value.EMAIL_RETRY_DELAYS_MS).map(Number);
  const consumerRetryDelays = csv(value.CONSUMER_RETRY_DELAYS_MS).map(Number);
  if (retryDelays.some((item) => !Number.isFinite(item) || item < 0)) {
    throw new Error('EMAIL_RETRY_DELAYS_MS contiene valores inválidos');
  }
  if (consumerRetryDelays.some((item) => !Number.isFinite(item) || item < 0)) {
    throw new Error('CONSUMER_RETRY_DELAYS_MS contiene valores inválidos');
  }

  return Object.freeze({
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    serviceName: value.SERVICE_NAME,
    logLevel: value.LOG_LEVEL,
    timezone: value.TZ,
    enableSwagger: value.ENABLE_SWAGGER,
    firestore: Object.freeze({
      projectId: value.FIREBASE_PROJECT_ID,
      credentialsPath: value.GOOGLE_APPLICATION_CREDENTIALS ?? null,
      emulatorHost: value.FIRESTORE_EMULATOR_HOST ?? null,
    }),
    kafka: Object.freeze({
      enabled: value.KAFKA_ENABLED,
      brokers: csv(value.KAFKA_BROKERS),
      clientId: value.KAFKA_CLIENT_ID,
      groupId: value.KAFKA_GROUP_ID,
      ssl: value.KAFKA_SSL,
      sasl: value.KAFKA_SASL_MECHANISM
        ? Object.freeze({
            mechanism: value.KAFKA_SASL_MECHANISM,
            username: value.KAFKA_SASL_USERNAME,
            password: value.KAFKA_SASL_PASSWORD,
          })
        : null,
      topics: Object.freeze({
        incident: value.KAFKA_TOPIC_INCIDENT,
        assignment: value.KAFKA_TOPIC_ASSIGNMENT,
        document: value.KAFKA_TOPIC_DOCUMENT,
        maintenance: value.KAFKA_TOPIC_MAINTENANCE,
        fuel: value.KAFKA_TOPIC_FUEL,
      }),
      dlqTopic: value.KAFKA_DLQ_TOPIC,
      consumerRetryDelaysMs: Object.freeze(consumerRetryDelays),
      consumerHeartbeatMs: value.CONSUMER_HEARTBEAT_MS,
    }),
    email: Object.freeze({
      provider: value.EMAIL_PROVIDER,
      apiKey: value.RESEND_API_KEY ?? null,
      from: value.EMAIL_FROM,
      timeoutMs: value.EMAIL_TIMEOUT_MS,
      retryDelaysMs: Object.freeze(retryDelays),
      maxAttempts: value.EMAIL_MAX_ATTEMPTS,
      circuitBreakerThreshold: value.EMAIL_CB_THRESHOLD,
      circuitBreakerResetMs: value.EMAIL_CB_RESET_MS,
    }),
    dispatch: Object.freeze({
      intervalMs: value.DISPATCH_INTERVAL_MS,
      batchSize: value.DISPATCH_BATCH_SIZE,
      leaseMs: value.DISPATCH_LEASE_MS,
    }),
    recipients: Object.freeze({
      FLEET_ADMINISTRATOR: value.RECIPIENT_FLEET_ADMINISTRATOR,
      MAINTENANCE_TECHNICIAN: value.RECIPIENT_MAINTENANCE_TECHNICIAN,
      MANAGEMENT: value.RECIPIENT_MANAGEMENT,
    }),
    health: Object.freeze({
      readinessTimeoutMs: value.READINESS_TIMEOUT_MS,
      shutdownTimeoutMs: value.SHUTDOWN_TIMEOUT_MS,
    }),
  });
};

module.exports = { envSchema, loadConfig };
