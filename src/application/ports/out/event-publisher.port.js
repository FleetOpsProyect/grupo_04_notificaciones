/**
 * Puerto para publicación de eventos propios del microservicio (SNS).
 * Se usa junto con el patrón Outbox (PublishOutboxEvents).
 */
class EventPublisherPort {
  /**
   * Publica un evento propio
   * @param {object} event
   * @param {object} [options]
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async publish(event, options = {}) {
    throw new Error('EventPublisherPort.publish debe ser implementado');
  }
}

module.exports = { EventPublisherPort };
