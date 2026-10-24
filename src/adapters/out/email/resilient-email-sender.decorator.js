const CircuitBreaker = require('opossum');
const { EmailDeliveryError } = require('../../../domain/errors');

const createCircuitOpenError = () => {
  const error = new Error('Circuit Breaker de correo abierto');
  error.name = 'CircuitBreakerOpenError';
  error.code = 'EOPENBREAKER';
  return error;
};

const createResilientEmailSender = ({
  sender,
  timeoutMs = 5000,
  circuitBreakerThreshold = 5,
  circuitBreakerResetMs = 30000,
  metrics,
  logger,
}) => {
  const breaker = new CircuitBreaker((message) => sender.send(message), {
    timeout: timeoutMs,
    errorThresholdPercentage: 100,
    volumeThreshold: circuitBreakerThreshold,
    resetTimeout: circuitBreakerResetMs,
    rollingCountTimeout: Math.max(circuitBreakerResetMs, 10000),
    errorFilter: (error) => error?.transient === false,
  });

  breaker.on('open', () => {
    metrics?.setCircuitBreakerState?.('open');
    logger?.error('Circuit Breaker de correo abierto');
  });
  breaker.on('halfOpen', () => {
    metrics?.setCircuitBreakerState?.('halfOpen');
    logger?.warn('Circuit Breaker de correo en half-open');
  });
  breaker.on('close', () => {
    metrics?.setCircuitBreakerState?.('closed');
    logger?.info('Circuit Breaker de correo cerrado');
  });
  metrics?.setCircuitBreakerState?.('closed');

  const send = async (message) => {
    try {
      return await breaker.fire(message);
    } catch (error) {
      if (error?.code === 'EOPENBREAKER' || error?.name === 'CircuitBreakerOpenError') {
        throw createCircuitOpenError();
      }
      if (error?.code === 'ETIMEDOUT' || error?.name === 'TimeoutError') {
        throw new EmailDeliveryError('Timeout al enviar correo', {
          transient: true,
          code: 'EMAIL_TIMEOUT',
        });
      }
      if (error instanceof EmailDeliveryError) {
        throw error;
      }
      throw new EmailDeliveryError('Fallo inesperado al enviar correo', {
        transient: true,
        code: 'EMAIL_DELIVERY_ERROR',
      });
    }
  };

  return {
    send,
    breaker,
    getState: () => {
      if (breaker.opened) {
        return 'open';
      }
      if (breaker.halfOpen) {
        return 'halfOpen';
      }
      return 'closed';
    },
  };
};

module.exports = { createResilientEmailSender, createCircuitOpenError };
