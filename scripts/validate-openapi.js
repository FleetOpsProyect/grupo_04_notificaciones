const SwaggerParser = require('@apidevtools/swagger-parser');
const { loadOpenApiDocument } = require('../src/adapters/in/http/openapi');

const main = async () => {
  const document = loadOpenApiDocument();
  await SwaggerParser.validate(document);
  process.stdout.write('OpenAPI válido: openapi/notification-service.yaml\n');
};

main().catch((error) => {
  process.stderr.write(`OpenAPI inválido: ${error.message}\n`);
  process.exitCode = 1;
});
