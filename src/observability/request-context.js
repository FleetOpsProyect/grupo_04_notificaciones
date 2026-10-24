const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

const runWithContext = (context, callback) => storage.run(context, callback);

const getRequestContext = () => storage.getStore() ?? null;

const getCorrelationId = () => getRequestContext()?.correlation_id ?? null;

module.exports = { runWithContext, getRequestContext, getCorrelationId };
