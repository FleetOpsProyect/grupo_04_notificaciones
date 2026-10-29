const { parseEventEnvelope } = require('../shared/event-envelope');

const readSqsAttribute = (message, name) => {
  const attribute = message?.MessageAttributes?.[name];
  return attribute?.StringValue ?? attribute?.BinaryValue ?? null;
};

const mapSqsMessageToEnvelope = (message) => {
  if (!message) {
    throw new Error('Mensaje SQS inválido');
  }

  const body = message.Body;
  if (!body) {
    throw new Error('Mensaje SQS sin Body');
  }

  let payloadToParse = body;
  let attributeEventType = readSqsAttribute(message, 'event_type');

  try {
    const parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
    if (parsedBody && parsedBody.Type === 'Notification' && parsedBody.Message) {
      payloadToParse = parsedBody.Message;
      attributeEventType =
        attributeEventType ?? parsedBody.MessageAttributes?.event_type?.Value ?? null;
    } else if (parsedBody && typeof parsedBody === 'object' && parsedBody.Message) {
      payloadToParse = parsedBody.Message;
    }
  } catch {
    // Si no es JSON, parseEventEnvelope reportará el error correspondiente.
  }

  return parseEventEnvelope(payloadToParse, { attributeEventType });
};

module.exports = { mapSqsMessageToEnvelope };
