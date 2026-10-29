const { SQSClient } = require('@aws-sdk/client-sqs');

const createSqsClient = (config = {}) => {
  const clientConfig = {
    region: config.region || process.env.AWS_REGION || 'us-east-1',
  };

  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
  }

  if (config.credentials) {
    clientConfig.credentials = {
      accessKeyId: config.credentials.accessKeyId,
      secretAccessKey: config.credentials.secretAccessKey,
      ...(config.credentials.sessionToken
        ? { sessionToken: config.credentials.sessionToken }
        : {}),
    };
  }

  const client = new SQSClient(clientConfig);
  return client;
};

module.exports = { createSqsClient };
