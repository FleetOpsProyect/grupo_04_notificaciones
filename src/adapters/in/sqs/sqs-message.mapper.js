const { parseEventEnvelope } = require('../kafka/event-envelope');

const mapSqsMessageToEnvelope = (message) => {
  if (!message) {
    throw new Error('Mensaje SQS inválido');
  }

  const body = message.Body;
  if (!body) {
    throw new Error('Mensaje SQS sin Body');
  }

  // Si viene de SNS->SQS, el Body puede ser JSON de SNS con Message
  let payloadToParse = body;
  try {
    const parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
    if (parsedBody && parsedBody.Type === 'Notification' && parsedBody.Message) {
      payloadToParse = parsedBody.Message;
    } else if (parsedBody && typeof parsedBody === 'object' && parsedBody.Message) {
      // Algunos formatos envuelven Message
      payloadToParse = parsedBody.Message;
    }
  } catch {
    // Si no es JSON, usar tal cual
  }

  const envelope = parseEventEnvelope(payloadToParse);
  return envelope;
};

module.exports = { mapSqsMessageToEnvelope };
