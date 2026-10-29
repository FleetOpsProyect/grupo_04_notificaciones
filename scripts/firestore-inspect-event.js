const { config } = require('../src/config/env');
const { createFirestoreClient } = require('../src/adapters/out/firestore/firestore.client');

const eventId = process.argv[2];

if (!eventId) {
  process.stderr.write('Uso: node scripts/firestore-inspect-event.js <event_id>\n');
  process.exitCode = 1;
} else {
  const toJson = (snapshot) => {
    if (!snapshot.exists) {
      return null;
    }
    return JSON.parse(
      JSON.stringify({ id: snapshot.id, ...snapshot.data() }, (_key, value) =>
        value && typeof value.toDate === 'function' ? value.toDate().toISOString() : value,
      ),
    );
  };

  const main = async () => {
    const firestore = createFirestoreClient(config);
    try {
      const [processed, alerts, notifications] = await Promise.all([
        firestore.db.collection('processed_events').doc(eventId).get(),
        firestore.db.collection('alerts').where('event_id', '==', eventId).get(),
        firestore.db.collection('notifications').where('event_id', '==', eventId).get(),
      ]);

      const outbox = [];
      for (const alert of alerts.docs) {
        const snapshot = await firestore.db
          .collection('outbox_events')
          .where('data.alert_id', '==', alert.id)
          .get();
        outbox.push(...snapshot.docs.map(toJson));
      }

      process.stdout.write(
        `${JSON.stringify(
          {
            event_id: eventId,
            processed_event: toJson(processed),
            alerts: alerts.docs.map(toJson),
            notifications: notifications.docs.map(toJson),
            outbox_events: outbox,
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      await firestore.close();
    }
  };

  main().catch((error) => {
    process.stderr.write(`No fue posible consultar Firestore: ${error.message}\n`);
    process.exitCode = 1;
  });
}
