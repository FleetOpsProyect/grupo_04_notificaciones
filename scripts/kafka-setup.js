const { config } = require('../src/config/env');
const { createKafkaClient } = require('../src/adapters/out/kafka/kafka.client');

const topicNames = [...new Set([...Object.values(config.kafka.topics), config.kafka.dlqTopic])];

const main = async () => {
  if (!config.kafka.enabled) {
    throw new Error('KAFKA_ENABLED debe ser true para configurar los topics');
  }

  const kafka = createKafkaClient({
    ...config.kafka,
    clientId: `${config.kafka.clientId}-setup`,
  });
  const admin = kafka.admin();

  try {
    await admin.connect();
    const existing = new Set(await admin.listTopics());
    const missing = topicNames.filter((topic) => !existing.has(topic));

    if (missing.length > 0) {
      await admin.createTopics({
        topics: missing.map((topic) => ({
          topic,
          numPartitions: 1,
          replicationFactor: 1,
        })),
        waitForLeaders: true,
      });
    }

    const current = await admin.listTopics();
    for (const topic of topicNames) {
      process.stdout.write(`${current.includes(topic) ? 'OK' : 'FALTA'} ${topic}\n`);
    }
  } finally {
    await admin.disconnect().catch(() => {});
  }
};

main().catch((error) => {
  process.stderr.write(`No fue posible configurar Kafka: ${error.message}\n`);
  process.exitCode = 1;
});
