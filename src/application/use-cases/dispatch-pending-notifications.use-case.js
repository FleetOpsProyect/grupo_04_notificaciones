const { decideFailure } = require('../../domain/policies/dispatch.policy');
const { safeErrorFields } = require('../shared/safe-log-fields');

const isCircuitOpen = (error) =>
  error?.code === 'EOPENBREAKER' ||
  error?.name === 'CircuitBreakerOpenError' ||
  error?.code === 'CIRCUIT_OPEN';

const createDispatchPendingNotificationsUseCase = ({
  notificationRepository,
  recipientDirectory,
  emailSender,
  clock,
  metrics,
  logger,
  batchSize = 20,
  leaseMs = 60000,
  retryDelaysMs = [30000, 120000, 600000],
  maxAttempts = 4,
}) => {
  return async function dispatchPendingNotifications({ limit = batchSize } = {}) {
    const now = clock.now();
    const due = await notificationRepository.findDuePending(now, limit);
    const result = { claimed: 0, sent: 0, failed: 0, retried: 0, skipped: 0, circuit_open: 0 };

    for (const candidate of due) {
      const claimed = await notificationRepository.claimForDispatch(
        candidate.notification_id,
        now,
        leaseMs,
      );
      if (claimed === null) {
        result.skipped += 1;
        continue;
      }
      result.claimed += 1;
      const recipient = recipientDirectory.resolve(claimed.recipient_role, claimed);
      if (!recipient) {
        const failed = claimed.markFailed(now, 'RECIPIENT_NOT_CONFIGURED');
        await notificationRepository.markFailed(failed);
        result.failed += 1;
        metrics?.dispatchTotal?.inc({ result: 'FAILED' });
        logger?.warn(
          { notification_id: claimed.notification_id, reason: 'RECIPIENT_NOT_CONFIGURED' },
          'Notificación sin destinatario configurado',
        );
        continue;
      }

      try {
        const response = await emailSender.send({
          to: recipient,
          subject: claimed.subject,
          text: claimed.message,
          notificationId: claimed.notification_id,
        });
        const sent = claimed.markSent(clock.now(), response.provider_message_id);
        await notificationRepository.markSent(sent);
        result.sent += 1;
        metrics?.dispatchTotal?.inc({ result: 'SENT' });
      } catch (error) {
        if (isCircuitOpen(error)) {
          await notificationRepository.releaseClaim(claimed.notification_id);
          result.circuit_open += 1;
          metrics?.dispatchTotal?.inc({ result: 'CIRCUIT_OPEN' });
          logger?.warn(
            { notification_id: claimed.notification_id },
            'Circuit Breaker abierto; se libera la reserva',
          );
          continue;
        }

        const failureCode = error?.code ?? 'EMAIL_DELIVERY_ERROR';
        const isTransient = error?.transient !== false;
        const decision = decideFailure({
          dispatchAttempts: claimed.dispatch_attempts,
          retryDelaysMs,
          maxAttempts,
        });
        logger?.warn(
          {
            notification_id: claimed.notification_id,
            ...safeErrorFields(error),
            failure_code: failureCode,
            attempts: decision.attempts,
            final: !isTransient || decision.final,
          },
          'Fallo al enviar correo',
        );

        if (!isTransient || decision.final) {
          const failed = claimed.markFailed(now, failureCode, decision.attempts);
          await notificationRepository.markFailed(failed);
          result.failed += 1;
          metrics?.dispatchTotal?.inc({ result: 'FAILED' });
        } else {
          const retry = claimed.scheduleRetry(
            new Date(now.getTime() + decision.delayMs),
            failureCode,
            decision.attempts,
          );
          await notificationRepository.scheduleRetry(retry);
          result.retried += 1;
          metrics?.dispatchTotal?.inc({ result: 'RETRY' });
        }
      }
    }

    return result;
  };
};

module.exports = { createDispatchPendingNotificationsUseCase, isCircuitOpen };
