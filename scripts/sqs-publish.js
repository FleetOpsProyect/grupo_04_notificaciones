const { randomUUID } = require('node:crypto');
const { config } = require('../src/config/env');
const { createSqsClient } = require('../src/adapters/out/sqs/sqs.client');
const { SendMessageCommand } = require('@aws-sdk/client-sqs');
const { buildScenarios } = require('./lib/event-scenarios');

const args = process.argv.slice(2);

const getArg = (name) => {
  const prefix = `--${name}=`;
  const argument = args.find((item) => item.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : undefined;
};

const scenario = getArg('scenario') ?? args.find((item) => !item.startsWith('--')) ?? 'incident';
const eventId = getArg('event-id') ?? randomUUID();
const correlationId = getArg('correlation-id') ?? randomUUID();

const scenarios = buildScenarios({ eventId, correlationId, origen: 'sqs-local-smoke' });
const selected = scenarios[scenario];

if (!selected) {
  process.stderr.write(
    `Escenario inválido: ${scenario}. Use: ${Object.keys(scenarios).join(', ')}\n`,
  );
  process.exitCode = 1;
} else {
  const main = async () => {
    if (!config.sqs.queueUrl) {
      throw new Error('SQS_QUEUE_URL no está configurada');
    }

    const sqsClient = createSqsClient({
      region: config.aws.region,
      endpoint: config.aws.endpoint,
      credentials: config.aws.credentials,
    });

    const body = selected.raw ?? JSON.stringify(selected.envelope);
    const groupId = getArg('group-id') ?? selected.envelope?.evento_id ?? `invalid-${Date.now()}`;
    const dedupId =
      getArg('dedup-id') ?? selected.envelope?.evento_id ?? `invalid-${Date.now()}-${Math.random()}`;

    try {
      const response = await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: config.sqs.queueUrl,
          MessageBody: body,
          MessageGroupId: groupId,
          MessageDeduplicationId: dedupId,
          MessageAttributes: {
            event_type: {
              DataType: 'String',
              StringValue: selected.envelope?.tipo_evento ?? 'UNKNOWN',
            },
            scenario: {
              DataType: 'String',
              StringValue: scenario,
            },
          },
        }),
      );

      process.stdout.write(
        `${JSON.stringify(
          {
            scenario,
            queue_url: config.sqs.queueUrl,
            message_id: response.MessageId ?? null,
            event_id: selected.envelope?.evento_id ?? null,
            correlation_id: selected.envelope?.correlation_id ?? null,
            group_id: groupId,
            dedup_id: dedupId,
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      sqsClient.destroy();
    }
  };

  main().catch((error) => {
    process.stderr.write(`No fue posible publicar el evento: ${error.message}\n`);
    process.exitCode = 1;
  });
}
