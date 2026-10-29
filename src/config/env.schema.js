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

    AWS_REGION: z.string().trim().default('us-east-1'),
    AWS_ENDPOINT_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().optional(),
    ),
    AWS_ACCESS_KEY_ID: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().optional(),
    ),
    AWS_SECRET_ACCESS_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional(),
    ),

    SQS_QUEUE_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().optional(),
    ),
    SQS_DLQ_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().optional(),
    ),
    SQS_WAIT_TIME_SECONDS: integer(20, 1),
    SQS_MAX_NUMBER_OF_MESSAGES: integer(10, 1),
    SQS_VISIBILITY_TIMEOUT_SECONDS: integer(30, 1),
    SQS_MAX_RECEIVE_COUNT: integer(4, 1),

    SNS_NOTIFICATION_TOPIC_ARN: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().optional(),
    ),

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

    OUTBOX_INTERVAL_MS: integer(2000, 1),
    OUTBOX_BATCH_SIZE: integer(20, 1),
    OUTBOX_LEASE_MS: integer(30000, 1),
    OUTBOX_RETRY_DELAYS_MS: z.string().default('5000,30000,120000'),

    CONSUMER_RETRY_DELAYS_MS: z.string().default('2000,10000,30000'),

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
  const outboxRetryDelays = csv(value.OUTBOX_RETRY_DELAYS_MS).map(Number);
  if (retryDelays.some((item) => !Number.isFinite(item) || item < 0)) {
    throw new Error('EMAIL_RETRY_DELAYS_MS contiene valores inválidos');
  }
  if (consumerRetryDelays.some((item) => !Number.isFinite(item) || item < 0)) {
    throw new Error('CONSUMER_RETRY_DELAYS_MS contiene valores inválidos');
  }
  if (outboxRetryDelays.some((item) => !Number.isFinite(item) || item < 0)) {
    throw new Error('OUTBOX_RETRY_DELAYS_MS contiene valores inválidos');
  }

  return Object.freeze({
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    serviceName: value.SERVICE_NAME,
    logLevel: value.LOG_LEVEL,
    timezone: value.TZ,
    enableSwagger: value.ENABLE_SWAGGER,
    aws: Object.freeze({
      region: value.AWS_REGION,
      endpoint: value.AWS_ENDPOINT_URL ?? null,
      credentials:
        value.AWS_ACCESS_KEY_ID && value.AWS_SECRET_ACCESS_KEY
          ? Object.freeze({
              accessKeyId: value.AWS_ACCESS_KEY_ID,
              secretAccessKey: value.AWS_SECRET_ACCESS_KEY,
            })
          : null,
    }),
    sqs: Object.freeze({
      queueUrl: value.SQS_QUEUE_URL ?? null,
      dlqUrl: value.SQS_DLQ_URL ?? null,
      waitTimeSeconds: value.SQS_WAIT_TIME_SECONDS,
      maxNumberOfMessages: value.SQS_MAX_NUMBER_OF_MESSAGES,
      visibilityTimeoutSeconds: value.SQS_VISIBILITY_TIMEOUT_SECONDS,
      maxReceiveCount: value.SQS_MAX_RECEIVE_COUNT,
      consumerRetryDelaysMs: Object.freeze(consumerRetryDelays),
    }),
    sns: Object.freeze({
      notificationTopicArn: value.SNS_NOTIFICATION_TOPIC_ARN ?? null,
    }),
    firestore: Object.freeze({
      projectId: value.FIREBASE_PROJECT_ID,
      credentialsPath: value.GOOGLE_APPLICATION_CREDENTIALS ?? null,
      emulatorHost: value.FIRESTORE_EMULATOR_HOST ?? null,
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
    outbox: Object.freeze({
      intervalMs: value.OUTBOX_INTERVAL_MS,
      batchSize: value.OUTBOX_BATCH_SIZE,
      leaseMs: value.OUTBOX_LEASE_MS,
      retryDelaysMs: Object.freeze(outboxRetryDelays),
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
