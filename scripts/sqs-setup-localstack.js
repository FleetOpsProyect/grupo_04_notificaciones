const { SQSClient, CreateQueueCommand } = require('@aws-sdk/client-sqs');
const { SNSClient, CreateTopicCommand } = require('@aws-sdk/client-sns');

const region = process.env.AWS_REGION || 'us-east-1';
const endpoint = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';

const sqs = new SQSClient({ region, endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
const sns = new SNSClient({ region, endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });

async function ensureQueue(name, attributes = {}) {
  try {
    const res = await sqs.send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }));
    return res.QueueUrl;
  } catch (error) {
    console.error('Error creando cola', name, error.message);
    throw error;
  }
}

async function ensureTopic(name) {
  try {
    const res = await sns.send(new CreateTopicCommand({ Name: name }));
    return res.TopicArn;
  } catch (error) {
    console.error('Error creando topic', name, error.message);
    throw error;
  }
}

async function main() {
  console.log('Creando recursos SQS/SNS en LocalStack...');
  const dlqUrl = await ensureQueue('notifications_dlq.fifo', {
    FifoQueue: 'true',
    ContentBasedDeduplication: 'true',
  });
  const queueUrl = await ensureQueue('notifications_queue.fifo', {
    FifoQueue: 'true',
    ContentBasedDeduplication: 'true',
    RedrivePolicy: JSON.stringify({
      deadLetterTargetArn: dlqUrl.replace('http://localhost:4566/000000000000/', 'arn:aws:sqs:us-east-1:000000000000:').replace('.fifo', '.fifo'), // simple
      maxReceiveCount: 5,
    }),
  });
  const topicArn = await ensureTopic('fleetops-notifications.fifo'); // SNS FIFO requiere .fifo
  
  console.log('DLQ_URL=' + dlqUrl);
  console.log('SQS_QUEUE_URL=' + queueUrl);
  console.log('SNS_NOTIFICATION_TOPIC_ARN=' + topicArn);
  console.log('\nCopia estas variables a tu .env para usar con LocalStack');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
