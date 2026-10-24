const DEFAULT_RETRY_DELAYS_MS = Object.freeze([30000, 120000, 600000]);
const DEFAULT_MAX_ATTEMPTS = 4;

const decideFailure = ({
  dispatchAttempts,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}) => {
  const attempts = dispatchAttempts + 1;
  const final = attempts >= maxAttempts || attempts > retryDelaysMs.length;
  return {
    attempts,
    final,
    delayMs: final ? null : retryDelaysMs[attempts - 1],
  };
};

const isDispatchDue = (notification, now) => {
  if (notification.dispatch_status !== 'PENDING_DISPATCH') {
    return false;
  }
  if (notification.next_attempt_at.getTime() > now.getTime()) {
    return false;
  }
  return notification.locked_until === null || notification.locked_until.getTime() <= now.getTime();
};

module.exports = {
  DEFAULT_RETRY_DELAYS_MS,
  DEFAULT_MAX_ATTEMPTS,
  decideFailure,
  isDispatchDue,
};
