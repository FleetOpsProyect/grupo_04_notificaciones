const { AttentionStatus } = require('../enums');

const nextAttentionStatus = (current) => {
  if (current === AttentionStatus.ATTENDED) {
    return AttentionStatus.ATTENDED;
  }
  return AttentionStatus.ATTENDED;
};

const shouldPreserveAttendedAt = (current) => current === AttentionStatus.ATTENDED;

module.exports = { nextAttentionStatus, shouldPreserveAttendedAt };
