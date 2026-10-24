class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

class InvalidDataError extends DomainError {
  constructor(message, errors = []) {
    super(message, 'INVALID_DATA');
    this.errors = errors;
  }
}

class InvalidStateTransitionError extends DomainError {
  constructor(message) {
    super(message, 'INVALID_STATE_TRANSITION');
  }
}

class InvalidParametersError extends DomainError {
  constructor(message, errors = []) {
    super(message, 'INVALID_PARAMETERS');
    this.errors = errors;
  }
}

class NotificationNotFoundError extends DomainError {
  constructor(notificationId) {
    super(`Notificación no encontrada: ${notificationId}`, 'NOTIFICATION_NOT_FOUND');
    this.notificationId = notificationId;
  }
}

class ServiceUnavailableError extends DomainError {
  constructor(message = 'Dependencia no disponible') {
    super(message, 'SERVICE_UNAVAILABLE');
  }
}

class EmailDeliveryError extends DomainError {
  constructor(message, { transient = true, code = 'EMAIL_DELIVERY_ERROR' } = {}) {
    super(message, code);
    this.transient = transient;
  }
}

module.exports = {
  DomainError,
  InvalidDataError,
  InvalidParametersError,
  InvalidStateTransitionError,
  NotificationNotFoundError,
  ServiceUnavailableError,
  EmailDeliveryError,
};
