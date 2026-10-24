const withTimeout = async (promise, timeoutMs) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('readiness timeout')), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const createReadiness = ({
  databaseCheck,
  brokerCheck,
  emailProviderName = 'console',
  timeoutMs = 3000,
}) => {
  return async function checkReadiness() {
    const checks = {
      database: { status: 'DOWN' },
      broker: { status: brokerCheck ? 'DOWN' : 'DISABLED' },
      email_provider: { status: 'UP', provider: emailProviderName },
    };

    try {
      await withTimeout(databaseCheck(), timeoutMs);
      checks.database.status = 'UP';
    } catch {
      checks.database.status = 'DOWN';
    }

    if (brokerCheck) {
      try {
        await withTimeout(brokerCheck(), timeoutMs);
        checks.broker.status = 'UP';
      } catch {
        checks.broker.status = 'DOWN';
      }
    }

    const ready = checks.database.status === 'UP';
    return {
      statusCode: ready ? 200 : 503,
      body: {
        status: ready ? 'READY' : 'NOT_READY',
        checks,
      },
    };
  };
};

module.exports = { createReadiness };
