const fs = require('node:fs');
const path = require('node:path');
const { GoogleAuth } = require('google-auth-library');
const { config } = require('../src/config/env');

const projectId = config.firestore.projectId;
const databaseId = '(default)';
const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(databaseId)}/collectionGroups`;
const indexesFile = path.join(__dirname, '..', 'firestore.indexes.json');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const indexSignature = (index) =>
  JSON.stringify({
    queryScope: index.queryScope,
    fields: index.fields.map((field) => ({
      fieldPath: field.fieldPath,
      order: field.order ?? null,
      arrayConfig: field.arrayConfig ?? null,
    })),
  });

const main = async () => {
  if (!config.firestore.credentialsPath) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS es obligatorio');
  }

  const desired = JSON.parse(fs.readFileSync(indexesFile, 'utf8')).indexes;
  const auth = new GoogleAuth({
    keyFile: config.firestore.credentialsPath,
    scopes: ['https://www.googleapis.com/auth/datastore'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  for (const index of desired) {
    const url = `${baseUrl}/${index.collectionGroup}/indexes`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        queryScope: index.queryScope,
        fields: index.fields,
      }),
    });
    const body = await response.text();

    if (response.ok) {
      const operation = JSON.parse(body);
      process.stdout.write(`CREANDO ${index.collectionGroup} ${operation.name}\n`);
      continue;
    }
    if (response.status === 409 || body.includes('ALREADY_EXISTS')) {
      process.stdout.write(`EXISTE ${indexSignature(index)}\n`);
      continue;
    }
    throw new Error(`Firestore respondió ${response.status}: ${body}`);
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const existing = [];
    for (const collectionGroup of new Set(desired.map((index) => index.collectionGroup))) {
      const url = `${baseUrl}/${collectionGroup}/indexes`;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Firestore respondió ${response.status}: ${await response.text()}`);
      }
      const body = await response.json();
      existing.push(...(body.indexes ?? []));
    }

    const ready = new Set(
      existing.filter((index) => index.state === 'READY').map((index) => indexSignature(index)),
    );
    const missing = desired.filter((index) => !ready.has(indexSignature(index)));
    if (missing.length === 0) {
      process.stdout.write('Índices listos\n');
      return;
    }
    process.stdout.write(`Esperando índices: ${missing.length}\n`);
    await wait(5000);
  }

  throw new Error('Los índices no alcanzaron el estado READY a tiempo');
};

main().catch((error) => {
  process.stderr.write(`No fue posible desplegar índices: ${error.message}\n`);
  process.exitCode = 1;
});
