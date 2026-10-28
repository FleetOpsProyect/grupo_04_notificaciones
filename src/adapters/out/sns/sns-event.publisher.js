const { PublishCommand } = require('@aws-sdk/client-sns');

const createSnsEventPublisher = ({ snsClient, topicArn }) => ({
  async publish(event, options = {}) {
    if (!topicArn) {
      throw new Error('SNS_NOTIFICATION_TOPIC_ARN no configurado');
    }

    const message = typeof event === 'string' ? event : JSON.stringify(event);
    const command = new PublishCommand({
      TopicArn: topicArn,
      Message: message,
      MessageAttributes: options.messageAttributes || {},
    });

    await snsClient.send(command);
  },
});

module.exports = { createSnsEventPublisher };
