const { DomainError } = require('../../../../domain/errors');
const { formatBogotaIso } = require('../../../../application/shared/time');
const { safeErrorFields } = require('../../../../application/shared/safe-log-fields');

const STATUS_BY_CODE = Object.freeze({
  INVALID_DATA: 400,
  INVALID_PARAMETERS: 400,
  INVALID_STATE_TRANSITION: 400,
  NOTIFICATION_NOT_FOUND: 404,
  SERVICE_UNAVAILABLE: 503,
});

const MESSAGE_BY_CODE = Object.freeze({
  SERVICE_UNAVAILABLE: 'Servicio temporalmente no disponible',
  INTERNAL_ERROR: 'Error interno del servidor',
});

const buildErrorBody = ({ req, codigo, mensaje, errores }) => ({
  codigo,
  mensaje,
  timestamp: formatBogotaIso(new Date()),
  ruta: req.originalUrl,
  correlation_id: req.correlation_id,
  ...(errores && errores.length > 0 ? { errores } : {}),
});

const errorHandler = (logger) => (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    res.status(400).json(
      buildErrorBody({
        req,
        codigo: 'MALFORMED_JSON',
        mensaje: 'El cuerpo de la solicitud no contiene JSON válido',
      }),
    );
    return;
  }

  if (error instanceof DomainError) {
    const status = STATUS_BY_CODE[error.code] ?? 400;
    if (status >= 500) {
      logger?.error(safeErrorFields(error), 'Error de dominio no disponible');
    }
    res.status(status).json(
      buildErrorBody({
        req,
        codigo: error.code,
        mensaje: MESSAGE_BY_CODE[error.code] ?? error.message,
        errores: error.errors,
      }),
    );
    return;
  }

  logger?.error(safeErrorFields(error), 'Error no controlado');
  res.status(500).json(
    buildErrorBody({
      req,
      codigo: 'INTERNAL_ERROR',
      mensaje: MESSAGE_BY_CODE.INTERNAL_ERROR,
    }),
  );
};

const notFoundHandler = (req, res) => {
  res.status(404).json(
    buildErrorBody({
      req,
      codigo: 'NOT_FOUND',
      mensaje: 'Ruta no encontrada',
    }),
  );
};

module.exports = { errorHandler, notFoundHandler, buildErrorBody };
