const { randomUUID } = require('node:crypto');
const { config } = require('../src/config/env');
const { createKafkaClient } = require('../src/adapters/out/kafka/kafka.client');

const args = process.argv.slice(2);

const getArg = (name) => {
  const prefix = `--${name}=`;
  const argument = args.find((item) => item.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : undefined;
};

const scenario = getArg('scenario') ?? args.find((item) => !item.startsWith('--')) ?? 'incident';
const eventId = getArg('event-id') ?? randomUUID();
const correlationId = getArg('correlation-id') ?? randomUUID();
const now = new Date().toISOString();

const baseEnvelope = {
  evento_id: eventId,
  version: 1,
  fecha_evento: now,
  origen: 'kafka-local-smoke',
  correlation_id: correlationId,
};

const scenarios = {
  incident: {
    topic: config.kafka.topics.incident,
    envelope: {
      ...baseEnvelope,
      tipo_evento: 'IncidenteReportadoEvent',
      datos: {
        incidente_id: `inc-${eventId}`,
        asignacion_id: `asg-${eventId}`,
        vehiculo_id: 'veh-smoke',
        conductor_id: 'con-smoke',
        tipo_incidente: 'FALLA_MECANICA',
        requiere_asistencia: true,
        fecha_reporte: now,
      },
    },
  },
  assignment: {
    topic: config.kafka.topics.assignment,
    envelope: {
      ...baseEnvelope,
      tipo_evento: 'AsignacionInterrumpidaEvent',
      datos: {
        empleado_email: 'conductor.prueba@example.invalid',
        resultado: 'MANUAL_REQUERIDA',
        asignacion_id: `asg-${eventId}`,
      },
    },
  },
  'document-expiring': {
    topic: config.kafka.topics.document,
    envelope: {
      ...baseEnvelope,
      tipo_evento: 'DocumentoProximoAVencerEvent',
      datos: {
        dias_restantes: 30,
        documento_id: `doc-${eventId}`,
        entidad_tipo: 'VEHICULO',
      },
    },
  },
  'document-expired': {
    topic: config.kafka.topics.document,
    envelope: {
      ...baseEnvelope,
      tipo_evento: 'DocumentoVencidoEvent',
      datos: {
        documento_id: `doc-${eventId}`,
        entidad_tipo: 'VEHICULO',
      },
    },
  },
  maintenance: {
    topic: config.kafka.topics.maintenance,
    envelope: {
      ...baseEnvelope,
      tipo_evento: 'MantenimientoPreventivoRequeridoEvent',
      datos: {
        kilometros: 150000,
        vehiculo_id: 'veh-smoke',
        mantenimiento_id: `mant-${eventId}`,
      },
    },
  },
  'invalid-envelope': {
    topic: config.kafka.topics.incident,
    raw: '{"evento_id":"no-es-uuid","tipo_evento":"IncidenteReportadoEvent"}',
  },
  'invalid-data': {
    topic: config.kafka.topics.incident,
    envelope: {
      ...baseEnvelope,
      tipo_evento: 'IncidenteReportadoEvent',
      datos: {
        incidente_id: `inc-${eventId}`,
      },
    },
  },
};

const selected = scenarios[scenario];

if (!selected) {
  process.stderr.write(
    `Escenario inválido: ${scenario}. Use: ${Object.keys(scenarios).join(', ')}\n`,
  );
  process.exitCode = 1;
} else {
  const main = async () => {
    const kafka = createKafkaClient({
      ...config.kafka,
      clientId: `${config.kafka.clientId}-publisher`,
    });
    const producer = kafka.producer();
    const value = selected.raw ?? JSON.stringify(selected.envelope);

    try {
      await producer.connect();
      await producer.send({
        topic: selected.topic,
        messages: [
          {
            key: selected.envelope?.evento_id ?? `invalid-${Date.now()}`,
            value,
            headers: { 'x-scenario': scenario },
          },
        ],
      });
    } finally {
      await producer.disconnect().catch(() => {});
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          scenario,
          topic: selected.topic,
          event_id: selected.envelope?.evento_id ?? null,
          correlation_id: selected.envelope?.correlation_id ?? null,
        },
        null,
        2,
      )}\n`,
    );
  };

  main().catch((error) => {
    process.stderr.write(`No fue posible publicar el evento: ${error.message}\n`);
    process.exitCode = 1;
  });
}
