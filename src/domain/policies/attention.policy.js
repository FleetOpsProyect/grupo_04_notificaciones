const { AcknowledgementStatus } = require('../enums');

const nextAcknowledgementStatus = (current) => {
  if (current === AcknowledgementStatus.ACKNOWLEDGED) {
    return AcknowledgementStatus.ACKNOWLEDGED;
  }
  return AcknowledgementStatus.ACKNOWLEDGED;
};

const shouldPreserveAcknowledgedAt = (current) => current === AcknowledgementStatus.ACKNOWLEDGED;

module.exports = { nextAcknowledgementStatus, shouldPreserveAcknowledgedAt };
