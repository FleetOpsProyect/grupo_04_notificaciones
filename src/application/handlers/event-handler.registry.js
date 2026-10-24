const incidenteReportado = require('./incidente-reportado.handler');
const asignacionInterrumpida = require('./asignacion-interrumpida.handler');
const documentoProximoAVencer = require('./documento-proximo-a-vencer.handler');
const documentoVencido = require('./documento-vencido.handler');
const mantenimientoPreventivoRequerido = require('./mantenimiento-preventivo-requerido.handler');
const pendingContract = require('./pending-contract.handler');

const MAIN_HANDLERS = Object.freeze([
  incidenteReportado,
  asignacionInterrumpida,
  documentoProximoAVencer,
  documentoVencido,
  mantenimientoPreventivoRequerido,
]);

const createEventHandlerRegistry = (handlers = MAIN_HANDLERS) => {
  const byType = new Map(handlers.map((handler) => [handler.eventType, handler]));
  for (const eventType of pendingContract.PENDING_EVENT_TYPES) {
    byType.set(eventType, { eventType, buildPlan: pendingContract.buildPlan });
  }
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
