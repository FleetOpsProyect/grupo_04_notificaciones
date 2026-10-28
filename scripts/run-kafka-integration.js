const { spawnSync } = require('node:child_process');
const jest = require.resolve('jest/bin/jest');

const result = spawnSync(process.execPath, [jest, 'test/integration', '--runInBand'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    KAFKA_INTEGRATION: 'true',
  },
});

process.exit(result.status ?? 1);
