const { Kafka, logLevel } = require('kafkajs');

const createKafkaClient = (kafkaConfig) =>
  new Kafka({
    clientId: kafkaConfig.clientId,
    brokers: kafkaConfig.brokers,
    ssl: kafkaConfig.ssl,
    sasl: kafkaConfig.sasl ?? undefined,
    logLevel: logLevel.NOTHING,
    retry: { retries: 8 },
  });

module.exports = { createKafkaClient };
