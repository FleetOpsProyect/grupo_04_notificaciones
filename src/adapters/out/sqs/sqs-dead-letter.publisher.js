const { SendMessageCommand } = require('@aws-sdk/client-sqs');

const sanitizeAttributes = (attributes = {}) => {
  const result = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (!value || !value.DataType) {
      continue;
    }
    const cleaned = { DataType: value.DataType };
    if (value.StringValue !== undefined) {
      cleaned.StringValue = value.StringValue;
    }
    if (value.BinaryValue !== undefined) {
      cleaned.BinaryValue = value.BinaryValue;
    }
    if (value.StringListValues?.length) {
      cleaned.StringListValues = value.StringListValues;
    }
    if (value.BinaryListValues?.length) {
      cleaned.BinaryListValues = value.BinaryListValues;
    }
    result[name] = cleaned;
  }
  return result;
};

const createSqsDeadLetterPublisher = ({ sqsClient, dlqUrl, clock }) => ({
  async publish({ originalMessage, reason, error, context = {} }) {
    if (!dlqUrl) {
      throw new Error('SQS_DLQ_URL no configurado');
    }

    const receiveCount = context.receive_count ?? 1;
    const groupId =
      originalMessage?.Attributes?.MessageGroupId ??
      context.event_id ??
      originalMessage?.MessageId ??
      'dlq';
    const deduplicationId = `${originalMessage?.MessageId ?? context.event_id ?? 'dlq'}-${receiveCount}-${reason ?? 'UNKNOWN'}`;

    const body =
      originalMessage?.Body ??
      JSON.stringify({
        reason: reason ?? 'UNKNOWN',
        error: error?.code ?? 'UNKNOWN',
        failed_at: clock.now().toISOString(),
      });

    const messageAttributes = sanitizeAttributes(originalMessage?.MessageAttributes);
    messageAttributes.error_reason = {
      DataType: 'String',
      StringValue: String(reason ?? 'UNKNOWN'),
    };
    messageAttributes.receive_count = {
      DataType: 'Number',
      StringValue: String(receiveCount),
    };

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: dlqUrl,
        MessageBody: body,
        MessageGroupId: String(groupId),
        MessageDeduplicationId: deduplicationId,
        MessageAttributes: messageAttributes,
      }),
    );
  },
});

module.exports = { createSqsDeadLetterPublisher, sanitizeAttributes };
