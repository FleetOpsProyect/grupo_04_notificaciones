const incidente = require('../../src/application/handlers/incidente-reportado.handler');
const asignacion = require('../../src/application/handlers/asignacion-interrumpida.handler');
const documentoProximo = require('../../src/application/handlers/documento-proximo-a-vencer.handler');
const documentoVencido = require('../../src/application/handlers/documento-vencido.handler');
const mantenimiento = require('../../src/application/handlers/mantenimiento-preventivo-requerido.handler');
const pending = require('../../src/application/handlers/pending-contract.handler');
const {
  createEventHandlerRegistry,
} = require('../../src/application/handlers/event-handler.registry');
const { InvalidDataError } = require('../../src/domain/errors');
const { Severity, Type } = require('../../src/domain/enums');
const { eventEnvelope } = require('../helpers/test-context');

describe('event handlers', () => {
  test('incidente genera dos notificaciones críticas', () => {
    const plan = incidente.buildPlan(eventEnvelope());
    expect(plan.alert).toMatchObject({
      type: Type.INCIDENT,
      severity: Severity.CRITICAL,
      reference_id: 'INC-001',
    });
    expect(plan.notifications).toHaveLength(2);
    expect(plan.notifications[0].subject).toContain('[URGENTE]');
  });

  test('incidente admite campos opcionales y rechaza datos inválidos', () => {
    const minimal = incidente.buildPlan(
      eventEnvelope({
        datos: {
          incidente_id: 'INC-2',
          vehiculo_id: 'VEH-2',
          tipo_incidente: 'Falla',
          requiere_asistencia: false,
          fecha_reporte: '2026-10-22T14:50:00.000Z',
        },
      }),
    );
    expect(minimal.notifications[0].subject).not.toContain('[URGENTE]');
    expect(() =>
      incidente.buildPlan(eventEnvelope({ datos: { ...eventEnvelope().datos, vehiculo_id: '' } })),
    ).toThrow(InvalidDataError);
  });

  test('asignación interrumpida genera una notificación al empleado', () => {
    const plan = asignacion.buildPlan(
      eventEnvelope({
        tipo_evento: 'AsignacionInterrumpidaEvent',
        datos: {
          empleado_email: '  Empleado@Example.COM ',
          resultado: 'AUTOMATICA_EXITOSA',
          asignacion_id: 'ASI-1',
        },
      }),
    );
    expect(plan.alert.severity).toBe(Severity.INFORMATIONAL);
    expect(plan.notifications[0]).toMatchObject({
      recipient_email: 'empleado@example.com',
      reference_id: 'ASI-1',
    });
  });

  test('asignación sin resultado queda WARNING y tolera campos opcionales', () => {
    const plan = asignacion.buildPlan(
      eventEnvelope({
        tipo_evento: 'AsignacionInterrumpidaEvent',
        datos: { empleado_email: 'empleado@example.com' },
      }),
    );
    expect(plan.alert.severity).toBe(Severity.WARNING);
    expect(plan.alert.reference_id).toBeNull();
    expect(plan.notifications[0].message).toContain('pendiente');
  });

  test('asignación rechaza correo inválido y resultado inválido', () => {
    expect(() =>
      asignacion.buildPlan(
        eventEnvelope({
          tipo_evento: 'AsignacionInterrumpidaEvent',
          datos: { empleado_email: 'no-email' },
        }),
      ),
    ).toThrow(InvalidDataError);
    expect(() =>
      asignacion.buildPlan(
        eventEnvelope({
          tipo_evento: 'AsignacionInterrumpidaEvent',
          datos: { empleado_email: 'a@b.co', resultado: 'OTRO' },
        }),
      ),
    ).toThrow(InvalidDataError);
  });

  test('documento próximo a vencer acepta 30, 15 y 5', () => {
    for (const days of [30, 15, 5, '15']) {
      const plan = documentoProximo.buildPlan(
        eventEnvelope({
          tipo_evento: 'DocumentoProximoAVencerEvent',
          datos: {
            dias_restantes: days,
            documento_id: 'DOC-1',
            entidad_tipo: 'VEHICLE',
          },
        }),
      );
      expect(plan.alert.severity).toBe(Severity.WARNING);
      expect(plan.notifications).toHaveLength(1);
      expect(plan.notifications[0].message).toContain('Días restantes');
    }
  });

  test('documento próximo rechaza días no permitidos', () => {
    expect(() =>
      documentoProximo.buildPlan(
        eventEnvelope({
          tipo_evento: 'DocumentoProximoAVencerEvent',
          datos: { dias_restantes: 10 },
        }),
      ),
    ).toThrow(InvalidDataError);
  });

  test('documento vencido genera alerta crítica', () => {
    const full = documentoVencido.buildPlan(
      eventEnvelope({
        tipo_evento: 'DocumentoVencidoEvent',
        datos: { documento_id: 'DOC-1', entidad_tipo: 'VEHICLE' },
      }),
    );
    expect(full.alert.severity).toBe(Severity.CRITICAL);
    const minimal = documentoVencido.buildPlan(
      eventEnvelope({ tipo_evento: 'DocumentoVencidoEvent', datos: {} }),
    );
    expect(minimal.alert.reference_id).toBeNull();
  });

  test('mantenimiento genera dos notificaciones y formatea kilómetros', () => {
    const plan = mantenimiento.buildPlan(
      eventEnvelope({
        tipo_evento: 'MantenimientoPreventivoRequeridoEvent',
        datos: {
          kilometros: '12345',
          vehiculo_id: 'VEH-1',
          mantenimiento_id: 'MAN-1',
        },
      }),
    );
    expect(plan.notifications).toHaveLength(2);
    expect(plan.notifications[0].message).toContain('12.345 km');
    const minimal = mantenimiento.buildPlan(
      eventEnvelope({
        tipo_evento: 'MantenimientoPreventivoRequeridoEvent',
        datos: {},
      }),
    );
    expect(minimal.alert.reference_id).toBeNull();
  });

  test('mantenimiento rechaza kilómetros negativos', () => {
    expect(() =>
      mantenimiento.buildPlan(
        eventEnvelope({
          tipo_evento: 'MantenimientoPreventivoRequeridoEvent',
          datos: { kilometros: -1 },
        }),
      ),
    ).toThrow(InvalidDataError);
  });

  test('el sobre puede no traer datos y falla con error de validación', () => {
    expect(() => incidente.buildPlan(eventEnvelope({ datos: undefined }))).toThrow(
      InvalidDataError,
    );
  });
});

describe('event handler registry', () => {
  test('registra los 10 eventos del catálogo', () => {
    const registry = createEventHandlerRegistry();
    expect(registry.types()).toHaveLength(10);
    expect(registry.resolve('IncidenteReportadoEvent')).toBe(incidente);
    expect(registry.resolve('NoExisteEvent')).toBeNull();
  });

  test('los eventos pendientes no generan plan', () => {
    const registry = createEventHandlerRegistry();
    for (const type of pending.PENDING_EVENT_TYPES) {
      expect(registry.resolve(type).buildPlan()).toBeNull();
    }
  });
});
