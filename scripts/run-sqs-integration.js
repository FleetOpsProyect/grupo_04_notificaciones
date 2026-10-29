const { spawnSync } = require('node:child_process');
const { SQSClient, ListQueuesCommand } = require('@aws-sdk/client-sqs');

const jest = require.resolve('jest/bin/jest');
const region = process.env.AWS_REGION || 'us-east-1';
const endpoint = process.env.AWS_ENDPOINT_URL || 'http://127.0.0.1:4566';

const preflight = async () => {
  const client = new SQSClient({
    region,
    endpoint,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  try {
    await client.send(new ListQueuesCommand({ MaxResults: 1 }));
  } finally {
    client.destroy();
  }
};

const main = async () => {
  try {
    await preflight();
  } catch (error) {
    process.stderr.write(
      `No fue posible conectar con SQS en ${endpoint}. ` +
        `Levante LocalStack (docker compose -f docker-compose.localstack.yml up -d) ` +
        `o configure AWS_ENDPOINT_URL. Detalle: ${error.message}\n`,
    );
    process.exit(1);
  }

  const result = spawnSync(
    process.execPath,
    [jest, 'test/integration/sqs.consumer.integration.test.js', '--runInBand'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        SQS_INTEGRATION: 'true',
      },
    },
  );

  process.exit(result.status ?? 1);
};

main();
