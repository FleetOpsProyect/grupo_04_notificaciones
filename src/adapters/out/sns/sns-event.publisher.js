const { PublishCommand } = require('@aws-sdk/client-sns');

const toMessageAttributes = (attributes = {}) =>
  Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => [
      name,
      { DataType: 'String', StringValue: String(value) },
    ]),
  );

const createSnsEventPublisher = ({ snsClient, topicArn }) => ({
  async publish(event, options = {}) {
    if (!topicArn) {
      throw new Error('SNS_NOTIFICATION_TOPIC_ARN no configurado');
    }

    const message = typeof event === 'string' ? event : JSON.stringify(event);
    const command = new PublishCommand({
      TopicArn: topicArn,
      Message: message,
      ...(options.groupId ? { MessageGroupId: String(options.groupId) } : {}),
      ...(options.deduplicationId
        ? { MessageDeduplicationId: String(options.deduplicationId) }
        : {}),
      MessageAttributes: toMessageAttributes(options.messageAttributes),
    });

    await snsClient.send(command);
  },
});

module.exports = { createSnsEventPublisher, toMessageAttributes };
