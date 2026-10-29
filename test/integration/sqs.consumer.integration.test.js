const { randomUUID } = require('node:crypto');
const {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
  DeleteQueueCommand,
  PurgeQueueCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} = require('@aws-sdk/client-sqs');
const { createSqsEventConsumer } = require('../../src/adapters/in/sqs/sqs-event.consumer');
const {
  createSqsDeadLetterPublisher,
} = require('../../src/adapters/out/sqs/sqs-dead-letter.publisher');
const { InvalidDataError, ServiceUnavailableError } = require('../../src/domain/errors');
const { createSilentLogger, eventEnvelope } = require('../helpers/test-context');

jest.setTimeout(40000);

const RUN = process.env.SQS_INTEGRATION === 'true';
const describeSqs = RUN ? describe : describe.skip;

const region = process.env.AWS_REGION || 'us-east-1';
const endpoint = process.env.AWS_ENDPOINT_URL || 'http://127.0.0.1:4566';
const credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
const sqsClient = new SQSClient({ region, endpoint, credentials });

const runId = `${Date.now()}-${process.pid}`;
const queueName = `it_notifications_${runId}.fifo`;
const dlqName = `it_notifications_dlq_${runId}.fifo`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate, label, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timeout esperando: ${label}`);
};

const getQueueArn = async (queueUrl) => {
  const response = await sqsClient.send(
    new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }),
  );
  return response.Attributes.QueueArn;
};

const queueAttributes = async (queueUrl) => {
  const response = await sqsClient.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    }),
  );
  return {
    visible: Number(response.Attributes.ApproximateNumberOfMessages ?? 0),
    inFlight: Number(response.Attributes.ApproximateNumberOfMessagesNotVisible ?? 0),
  };
};

describeSqs('consumidor SQS contra LocalStack', () => {
  let queueUrl;
  let dlqUrl;
  let consumer;
  let deadLetterPublisher;

  beforeAll(async () => {
    dlqUrl = (
      await sqsClient.send(
        new CreateQueueCommand({
          QueueName: dlqName,
          Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'true' },
        }),
      )
    ).QueueUrl;
    const dlqArn = await getQueueArn(dlqUrl);

    queueUrl = (
      await sqsClient.send(
        new CreateQueueCommand({
          QueueName: queueName,
          Attributes: {
            FifoQueue: 'true',
            ContentBasedDeduplication: 'true',
            VisibilityTimeout: '2',
          },
        }),
      )
    ).QueueUrl;

    await sqsClient.send(
      new SetQueueAttributesCommand({
        QueueUrl: queueUrl,
        Attributes: {
          RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 4 }),
        },
      }),
    );

    deadLetterPublisher = createSqsDeadLetterPublisher({
      sqsClient,
      dlqUrl,
      clock: { now: () => new Date() },
    });
  });

  afterAll(async () => {
    if (consumer) {
      await consumer.stop().catch(() => {});
      consumer = null;
    }
    await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => {});
    await sqsClient.send(new DeleteQueueCommand({ QueueUrl: dlqUrl })).catch(() => {});
    sqsClient.destroy();
  });

  beforeEach(async () => {
    if (consumer) {
      await consumer.stop().catch(() => {});
      consumer = null;
    }
    await sqsClient.send(new PurgeQueueCommand({ QueueUrl: queueUrl })).catch(() => {});
    await sqsClient.send(new PurgeQueueCommand({ QueueUrl: dlqUrl })).catch(() => {});
    await sleep(300);
  });

  const startConsumer = async (processDomainEvent) => {
    consumer = createSqsEventConsumer({
      sqsClient,
      sqsConfig: {
        waitTimeSeconds: 1,
        maxNumberOfMessages: 10,
        visibilityTimeoutSeconds: 2,
        consumerRetryDelaysMs: [1000, 1000, 1000],
        maxReceiveCount: 4,
      },
      queueUrl,
      processDomainEvent,
      deadLetterPublisher,
      logger: createSilentLogger(),
      metrics: { dlqMessages: { inc: jest.fn() } },
    });
    await consumer.start();
  };

  const publish = async (body, { dedupId } = {}) => {
    const envelope = typeof body === 'string' ? null : body;
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: typeof body === 'string' ? body : JSON.stringify(body),
        MessageGroupId: envelope?.event_id ?? `invalid-${randomUUID()}`,
        MessageDeduplicationId: dedupId ?? envelope?.event_id ?? randomUUID(),
        MessageAttributes: {
          event_type: {
            DataType: 'String',
            StringValue: envelope?.event_type ?? 'UNKNOWN',
          },
        },
      }),
    );
  };

  const receiveFromDlq = async (timeoutMs = 10000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: dlqUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 1,
          MessageAttributeNames: ['All'],
        }),
      );
      const message = (response.Messages || [])[0];
      if (message) {
        await sqsClient.send(
          new DeleteMessageCommand({ QueueUrl: dlqUrl, ReceiptHandle: message.ReceiptHandle }),
        );
        return message;
      }
    }
    return null;
  };

  test('procesa un evento y lo borra de la cola', async () => {
    const calls = [];
    await startConsumer(async (envelope) => {
      calls.push(envelope);
      return { status: 'processed', event_id: envelope.event_id };
    });
    const envelope = eventEnvelope({ event_id: randomUUID() });

    await publish(envelope);

    await waitFor(() => calls.length === 1, 'procesamiento del evento');
    expect(calls[0].event_id).toBe(envelope.event_id);
    await waitFor(async () => (await queueAttributes(queueUrl)).visible === 0, 'borrado del mensaje');
    expect(await receiveFromDlq()).toBeNull();
  });

  test('un sobre inválido va a la DLQ con error_reason y receive_count', async () => {
    const processor = jest.fn();
    await startConsumer(processor);

    await publish('{"event_id":"no-es-uuid","event_type":"severe_incident_reported_event"}');

    const message = await receiveFromDlq();
    expect(message).not.toBeNull();
    expect(message.Body).toContain('no-es-uuid');
    expect(message.MessageAttributes.error_reason.StringValue).toBe('INVALID_ENVELOPE');
    expect(message.MessageAttributes.receive_count.StringValue).toBe('1');
    expect(processor).not.toHaveBeenCalled();
  });

  test('un error permanente de datos va a la DLQ inmediatamente', async () => {
    await startConsumer(
      jest.fn().mockRejectedValue(new InvalidDataError('Paylaod inválido para el handler')),
    );

    await publish(eventEnvelope({ event_id: randomUUID() }));

    const message = await receiveFromDlq();
    expect(message).not.toBeNull();
    expect(message.MessageAttributes.error_reason.StringValue).toBe('INVALID_EVENT_DATA');
  });

  test('un error transitorio reprograma la visibilidad y termina en DLQ al cuarto recibo', async () => {
    const processor = jest
      .fn()
      .mockRejectedValue(new ServiceUnavailableError('Firestore no disponible'));
    await startConsumer(processor);

    await publish(eventEnvelope({ event_id: randomUUID() }));

    const message = await receiveFromDlq();
    expect(message).not.toBeNull();
    expect(message.MessageAttributes.error_reason.StringValue).toBe('MAX_RECEIVE_COUNT');
    expect(message.MessageAttributes.receive_count.StringValue).toBe('4');
    expect(processor).toHaveBeenCalledTimes(4);
    expect((await queueAttributes(queueUrl)).visible).toBe(0);
  });
});
