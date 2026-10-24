const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');

const DEFAULT_OPENAPI_PATH = path.resolve(
  __dirname,
  '../../../../openapi/notification-service.yaml',
);

const loadOpenApiDocument = (filePath = DEFAULT_OPENAPI_PATH) =>
  yaml.parse(fs.readFileSync(filePath, 'utf8'));

module.exports = { loadOpenApiDocument, DEFAULT_OPENAPI_PATH };
