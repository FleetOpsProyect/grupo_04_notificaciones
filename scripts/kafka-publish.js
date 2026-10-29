const { randomUUID } = require('node:crypto');
const { config } = require('../src/config/env');
const { createKafkaClient } = require('../src/adapters/out/kafka/kafka.client');
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

const scenarios = buildScenarios({ eventId, correlationId, origen: 'kafka-local-smoke' });

const TOPIC_BY_SCENARIO = Object.freeze({
  incident: config.kafka.topics.incident,
  assignment: config.kafka.topics.assignment,
  'document-expiring': config.kafka.topics.document,
  'document-expired': config.kafka.topics.document,
  maintenance: config.kafka.topics.maintenance,
  'invalid-envelope': config.kafka.topics.incident,
  'invalid-data': config.kafka.topics.incident,
});

const selected = scenarios[scenario];

if (!selected) {
  process.stderr.write(
    `Escenario inválido: ${scenario}. Use: ${Object.keys(scenarios).join(', ')}\n`,
  );
  process.exitCode = 1;
} else {
  const topic = TOPIC_BY_SCENARIO[scenario];

  const main = async () => {
    const kafka = createKafkaClient({
      ...config.kafka,
      clientId: `${config.kafka.clientId}-publisher`,
    });
    const producer = kafka.producer();
    const value = selected.raw ?? JSON.stringify(selected.envelope);

    try {
      await producer.connect();
      await producer.send({
        topic,
        messages: [
          {
            key: selected.envelope?.evento_id ?? `invalid-${Date.now()}`,
            value,
            headers: { 'x-scenario': scenario },
          },
        ],
      });
    } finally {
      await producer.disconnect().catch(() => {});
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          scenario,
          topic,
          event_id: selected.envelope?.evento_id ?? null,
          correlation_id: selected.envelope?.correlation_id ?? null,
        },
        null,
        2,
      )}\n`,
    );
  };

  main().catch((error) => {
    process.stderr.write(`No fue posible publicar el evento: ${error.message}\n`);
    process.exitCode = 1;
  });
}
