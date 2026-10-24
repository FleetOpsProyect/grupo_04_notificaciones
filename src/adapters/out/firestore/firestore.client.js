const { initializeApp, getApps, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APP_NAME = 'fleetops-notification-service';

const createFirestoreClient = (config) => {
  if (config.firestore.emulatorHost) {
    process.env.FIRESTORE_EMULATOR_HOST = config.firestore.emulatorHost;
  }
  if (config.firestore.credentialsPath) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = config.firestore.credentialsPath;
  }

  const existing = getApps().find((app) => app.name === APP_NAME);
  const app = existing ?? initializeApp({ projectId: config.firestore.projectId }, APP_NAME);
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  return {
    app,
    db,
    async databaseCheck() {
      await db.collection('alerts').limit(1).get();
    },
    async close() {
      await deleteApp(app);
    },
  };
};

module.exports = { createFirestoreClient };
