const dotenv = require('dotenv');
const { loadConfig } = require('./env.schema');

dotenv.config({ quiet: true });

const config = loadConfig(process.env);

module.exports = { config };
