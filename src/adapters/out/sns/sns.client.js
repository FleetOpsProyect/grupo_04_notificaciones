const { SNSClient } = require('@aws-sdk/client-sns');

const createSnsClient = (config = {}) => {
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
      ...(config.credentials.sessionToken ? { sessionToken: config.credentials.sessionToken } : {}),
    };
  }

  const client = new SNSClient(clientConfig);
  return client;
};

module.exports = { createSnsClient };
