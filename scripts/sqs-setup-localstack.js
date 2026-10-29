const {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
} = require('@aws-sdk/client-sqs');
const { SNSClient, CreateTopicCommand } = require('@aws-sdk/client-sns');

const region = process.env.AWS_REGION || 'us-east-1';
const endpoint = process.env.AWS_ENDPOINT_URL || 'http://127.0.0.1:4566';
const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };

const sqs = new SQSClient({ region, endpoint, credentials });
const sns = new SNSClient({ region, endpoint, credentials });

const ensureQueue = async (name, attributes = {}) => {
  const res = await sqs.send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }));
  return res.QueueUrl;
};

const getQueueArn = async (queueUrl) => {
  const res = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }),
  );
  return res.Attributes.QueueArn;
};

const ensureTopic = async (name) => {
  const res = await sns.send(
    new CreateTopicCommand({
      Name: name,
      Attributes: {
        FifoTopic: 'true',
        ContentBasedDeduplication: 'true',
      },
    }),
  );
  return res.TopicArn;
};

const main = async () => {
  console.log('Creando recursos SQS/SNS en LocalStack...');

  const dlqUrl = await ensureQueue('notifications_dlq.fifo', {
    FifoQueue: 'true',
    ContentBasedDeduplication: 'true',
  });
  const dlqArn = await getQueueArn(dlqUrl);

  const queueUrl = await ensureQueue('notifications_queue.fifo', {
    FifoQueue: 'true',
    ContentBasedDeduplication: 'true',
    VisibilityTimeout: '30',
  });

  await sqs.send(
    new SetQueueAttributesCommand({
      QueueUrl: queueUrl,
      Attributes: {
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: dlqArn,
          maxReceiveCount: 5,
        }),
      },
    }),
  );

  const topicArn = await ensureTopic('fleetops_notification_events.fifo');

  console.log('\n=== Recursos creados ===');
  console.log('BROKER_TYPE=sqs');
  console.log(`AWS_REGION=${region}`);
  console.log(`AWS_ENDPOINT_URL=${endpoint}`);
  console.log('AWS_ACCESS_KEY_ID=test');
  console.log('AWS_SECRET_ACCESS_KEY=test');
  console.log(`SQS_QUEUE_URL=${queueUrl}`);
  console.log(`SQS_DLQ_URL=${dlqUrl}`);
  console.log(`SNS_NOTIFICATION_TOPIC_ARN=${topicArn}`);
  console.log('\nCopia estas variables a tu .env');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
