/**
 * Contrato de un handler de evento.
 * @typedef {{
 *   eventType: string,
 *   buildPlan: (envelope: object, context?: object) => object | null
 * }} DomainEventHandler
 */
module.exports = {};
