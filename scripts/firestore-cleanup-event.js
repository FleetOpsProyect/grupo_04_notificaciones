const { config } = require('../src/config/env');
const { createFirestoreClient } = require('../src/adapters/out/firestore/firestore.client');

const eventIds = process.argv.slice(2);

if (eventIds.length === 0) {
  process.stderr.write('Uso: node scripts/firestore-cleanup-event.js <evento_id> [...]\n');
  process.exitCode = 1;
} else {
  const main = async () => {
    const firestore = createFirestoreClient(config);
    try {
      for (const eventId of eventIds) {
        const [alerts, notifications] = await Promise.all([
          firestore.db.collection('alerts').where('event_id', '==', eventId).get(),
          firestore.db.collection('notifications').where('event_id', '==', eventId).get(),
        ]);
        const batch = firestore.db.batch();

        for (const document of alerts.docs) {
          batch.delete(document.ref);
        }
        for (const document of notifications.docs) {
          batch.delete(document.ref);
        }
        batch.delete(firestore.db.collection('processed_events').doc(eventId));
        await batch.commit();

        process.stdout.write(
          `${eventId}: alerts=${alerts.size} notifications=${notifications.size} procesado=eliminado\n`,
        );
      }
    } finally {
      await firestore.close();
    }
  };

  main().catch((error) => {
    process.stderr.write(`No fue posible limpiar Firestore: ${error.message}\n`);
    process.exitCode = 1;
  });
}
