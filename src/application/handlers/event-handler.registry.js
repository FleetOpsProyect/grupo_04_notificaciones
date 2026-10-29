const { severeIncidentHandler, minorIncidentHandler } = require('./incident.handler');
const interruptedAssignment = require('./interrupted-assignment.handler');
const documentExpiring = require('./document-expiring.handler');
const documentExpired = require('./document-expired.handler');
const maintenanceRequired = require('./maintenance-required.handler');
const {
  fuelAnomalyHandler,
  consumoAnomaloHandler,
} = require('./fuel-anomaly.handler');

const MAIN_HANDLERS = Object.freeze([
  severeIncidentHandler,
  minorIncidentHandler,
  interruptedAssignment,
  documentExpiring,
  documentExpired,
  maintenanceRequired,
  fuelAnomalyHandler,
  consumoAnomaloHandler,
]);

const createEventHandlerRegistry = (handlers = MAIN_HANDLERS) => {
  const byType = new Map(handlers.map((handler) => [handler.eventType, handler]));
  return {
    resolve(eventType) {
      return byType.get(eventType) ?? null;
    },
    types() {
      return [...byType.keys()];
    },
  };
};

module.exports = { createEventHandlerRegistry, MAIN_HANDLERS };
