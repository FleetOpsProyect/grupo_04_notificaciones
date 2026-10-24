const { RecipientRole } = require('../../../domain/enums');

const createEnvRecipientDirectory = ({ recipients }) => ({
  resolve(role, notification) {
    if (role === RecipientRole.EMPLOYEE) {
      return notification.recipient_email ?? null;
    }
    return recipients[role] ?? null;
  },
});

module.exports = { createEnvRecipientDirectory };
