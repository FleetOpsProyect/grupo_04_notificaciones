const { SendMessageCommand } = require('@aws-sdk/client-sqs');
const { safeErrorFields } = require('../../../application/shared/safe-log-fields');

const createSqsDeadLetterPublisher = ({ sqsClient, dlqUrl, clock }) => ({
  async publish({ originalMessage, reason, error, context = {} }) {
    if (!dlqUrl) {
      throw new Error('SQS_DLQ_URL no configurado');
    }

    const payload = {
      reason,
      error: safeErrorFields(error),
      context,
      failed_at: clock.now().toISOString(),
      original_message: originalMessage?.Body ?? null,
    };

    const failedAt = payload.failed_at;
    const groupId =
      context.event_id ?? originalMessage?.MessageId ?? originalMessage?.ReceiptHandle ?? 'dlq';
    const dedupId = `${groupId}-${failedAt}-${reason ?? 'UNKNOWN'}`;

    const command = new SendMessageCommand({
      QueueUrl: dlqUrl,
      MessageBody: JSON.stringify(payload),
      MessageGroupId: String(groupId),
      MessageDeduplicationId: dedupId,
      MessageAttributes: {
        reason: {
          DataType: 'String',
          StringValue: reason || 'UNKNOWN',
        },
        error_code: {
          DataType: 'String',
          StringValue: error?.code ?? 'UNKNOWN',
        },
      },
    });

    await sqsClient.send(command);
  },
});

module.exports = { createSqsDeadLetterPublisher };
