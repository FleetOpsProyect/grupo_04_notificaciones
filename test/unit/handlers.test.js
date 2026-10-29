const {
  severeIncidentHandler,
  minorIncidentHandler,
} = require('../../src/application/handlers/incident.handler');
const assignment = require('../../src/application/handlers/interrupted-assignment.handler');
const documentExpiring = require('../../src/application/handlers/document-expiring.handler');
const documentExpired = require('../../src/application/handlers/document-expired.handler');
const maintenance = require('../../src/application/handlers/maintenance-required.handler');
const {
  fuelAnomalyHandler,
  consumoAnomaloHandler,
} = require('../../src/application/handlers/fuel-anomaly.handler');
const { IGNORED_EVENT_TYPES } = require('../../src/application/handlers/ignored-events');
const {
  createEventHandlerRegistry,
} = require('../../src/application/handlers/event-handler.registry');
const { InvalidDataError } = require('../../src/domain/errors');
const { Severity, Type } = require('../../src/domain/enums');
const { eventEnvelope } = require('../helpers/test-context');

describe('event handlers', () => {
  test('incidente grave genera dos notificaciones críticas', () => {
    const plan = severeIncidentHandler.buildPlan(eventEnvelope());
    expect(plan.alert).toMatchObject({
      type: Type.INCIDENT,
      severity: Severity.CRITICAL,
      reference_id: 'INC-001',
    });
    expect(plan.notifications).toHaveLength(2);
    expect(plan.notifications[0].subject).toContain('[URGENTE]');
    expect(plan.notifications[0].message).toContain('REQUIERE ASISTENCIA INMEDIATA');
  });

  test('incidente leve genera dos notificaciones con severidad WARNING', () => {
    const plan = minorIncidentHandler.buildPlan(
      eventEnvelope({
        event_type: 'minor_incident_reported_event',
        data: { ...eventEnvelope().data, requiere_asistencia: false },
      }),
    );
    expect(plan.alert.severity).toBe(Severity.WARNING);
    expect(plan.notifications).toHaveLength(2);
    expect(plan.notifications[0].subject).not.toContain('[URGENTE]');
    expect(plan.notifications[0].message).toContain('incidente leve');
  });

  test('incidente admite campos opcionales y rechaza datos inválidos', () => {
    const minimal = severeIncidentHandler.buildPlan(
      eventEnvelope({
        data: {
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
      severeIncidentHandler.buildPlan(
        eventEnvelope({ data: { ...eventEnvelope().data, vehiculo_id: '' } }),
      ),
    ).toThrow(InvalidDataError);
  });

  test('asignación interrumpida genera una notificación al empleado', () => {
    const plan = assignment.buildPlan(
      eventEnvelope({
        event_type: 'interrupted_assignment_event',
        data: {
          assignment_id: 'ASG-1',
          employee_email: '  Empleado@Example.COM ',
          reassignment_result: 'AUTOMATIC_SUCCESSFUL',
          new_assignment_id: 'ASG-2',
        },
      }),
    );
    expect(plan.alert.severity).toBe(Severity.INFO);
    expect(plan.alert.reference_id).toBe('ASG-1');
    expect(plan.notifications[0]).toMatchObject({
      recipient_email: 'empleado@example.com',
      reference_id: 'ASG-1',
    });
    expect(plan.notifications[0].message).toContain('ASG-2');
  });

  test('asignación sin resultado queda WARNING y tolera campos opcionales', () => {
    const plan = assignment.buildPlan(
      eventEnvelope({
        event_type: 'interrupted_assignment_event',
        data: { assignment_id: 'ASG-1', employee_email: 'empleado@example.com' },
      }),
    );
    expect(plan.alert.severity).toBe(Severity.WARNING);
    expect(plan.notifications[0].message).toContain('pendiente');
  });

  test('asignación rechaza correo inválido y resultado inválido', () => {
    expect(() =>
      assignment.buildPlan(
        eventEnvelope({
          event_type: 'interrupted_assignment_event',
          data: { assignment_id: 'ASG-1', employee_email: 'no-email' },
        }),
      ),
    ).toThrow(InvalidDataError);
    expect(() =>
      assignment.buildPlan(
        eventEnvelope({
          event_type: 'interrupted_assignment_event',
          data: {
            assignment_id: 'ASG-1',
            employee_email: 'a@b.co',
            reassignment_result: 'OTRO',
          },
        }),
      ),
    ).toThrow(InvalidDataError);
  });

  test('documento próximo a vencer acepta los umbrales del DAS', () => {
    for (const days of [30, 15, 7, 1, '15']) {
      const plan = documentExpiring.buildPlan(
        eventEnvelope({
          event_type: 'document_expiring_soon_event',
          data: {
            document_id: 'DOC-1',
            document_type: 'SOAT',
            owner_type: 'VEHICLE',
            days_remaining: days,
            threshold_days: 30,
          },
        }),
      );
      expect(plan.alert.severity).toBe(Severity.WARNING);
      expect(plan.notifications).toHaveLength(1);
      expect(plan.notifications[0].recipient_role).toBe('FLEET_ADMINISTRATOR');
      expect(plan.notifications[0].message).toContain('Días restantes');
    }
  });

  test('documento próximo rechaza días inválidos', () => {
    expect(() =>
      documentExpiring.buildPlan(
        eventEnvelope({
          event_type: 'document_expiring_soon_event',
          data: { document_id: 'DOC-1', days_remaining: -1 },
        }),
      ),
    ).toThrow(InvalidDataError);
  });

  test('documento vencido genera alerta crítica', () => {
    const full = documentExpired.buildPlan(
      eventEnvelope({
        event_type: 'document_expired_event',
        data: { document_id: 'DOC-1', document_type: 'SOAT', owner_type: 'VEHICLE' },
      }),
    );
    expect(full.alert.severity).toBe(Severity.CRITICAL);
    expect(full.alert.reference_id).toBe('DOC-1');
    expect(() =>
      documentExpired.buildPlan(eventEnvelope({ event_type: 'document_expired_event', data: {} })),
    ).toThrow(InvalidDataError);
  });

  test('mantenimiento genera dos notificaciones y formatea kilómetros', () => {
    const plan = maintenance.buildPlan(
      eventEnvelope({
        event_type: 'MantenimientoPreventivoRequeridoEvent',
        data: {
          mantenimiento_id: 'MAN-1',
          vehiculo_id: 'VEH-1',
          kilometraje_actual: '12345',
          umbral_km: 15000,
          motivo: 'Preventivo',
        },
      }),
    );
    expect(plan.notifications).toHaveLength(2);
    expect(plan.notifications[0].message).toContain('12.345 km');
    expect(plan.notifications[0].message).toContain('15.000 km');
    expect(plan.notifications[0].message).toContain('Preventivo');
    const minimal = maintenance.buildPlan(
      eventEnvelope({
        event_type: 'MantenimientoPreventivoRequeridoEvent',
        data: {},
      }),
    );
    expect(minimal.alert.reference_id).toBeNull();
  });

  test('mantenimiento rechaza kilómetros negativos', () => {
    expect(() =>
      maintenance.buildPlan(
        eventEnvelope({
          event_type: 'MantenimientoPreventivoRequeridoEvent',
          data: { kilometraje_actual: -1 },
        }),
      ),
    ).toThrow(InvalidDataError);
  });

  test('combustible acepta ambos alias y payload en inglés o español', () => {
    const english = fuelAnomalyHandler.buildPlan(
      eventEnvelope({
        event_type: 'fuel_anomaly_detected_event',
        data: {
          fuel_record_id: 'FUEL-1',
          vehicle_id: 'VEH-1',
          efficiency_km_per_gallon: 28.5,
          average_efficiency_km_per_gallon: 42.1,
          gallons_purchased: 10,
        },
      }),
    );
    expect(english.alert).toMatchObject({
      type: Type.FUEL,
      severity: Severity.WARNING,
      reference_id: 'FUEL-1',
    });
    expect(english.notifications).toHaveLength(1);
    expect(english.notifications[0].recipient_role).toBe('FLEET_ADMINISTRATOR');
    expect(english.notifications[0].message).toContain('28,50');

    const spanish = consumoAnomaloHandler.buildPlan(
      eventEnvelope({
        event_type: 'ConsumoAnomaloDetectadoEvent',
        data: {
          combustible_id: 'FUEL-2',
          vehiculo_id: 'VEH-2',
          rendimiento: 30,
          rendimiento_promedio: 45,
        },
      }),
    );
    expect(spanish.alert.reference_id).toBe('FUEL-2');
    expect(spanish.alert.source_event_type).toBe('ConsumoAnomaloDetectadoEvent');
  });

  test('el sobre puede no traer datos y falla con error de validación', () => {
    expect(() => severeIncidentHandler.buildPlan(eventEnvelope({ data: undefined }))).toThrow(
      InvalidDataError,
    );
  });
});

describe('event handler registry', () => {
  test('registra los siete eventos con aviso y el alias de combustible', () => {
    const registry = createEventHandlerRegistry();
    expect(registry.types()).toHaveLength(8);
    expect(registry.resolve('severe_incident_reported_event')).toBe(severeIncidentHandler);
    expect(registry.resolve('minor_incident_reported_event')).toBe(minorIncidentHandler);
    expect(registry.resolve('interrupted_assignment_event')).toBe(assignment);
    expect(registry.resolve('document_expiring_soon_event')).toBe(documentExpiring);
    expect(registry.resolve('document_expired_event')).toBe(documentExpired);
    expect(registry.resolve('MantenimientoPreventivoRequeridoEvent')).toBe(maintenance);
    expect(registry.resolve('fuel_anomaly_detected_event')).toBe(fuelAnomalyHandler);
    expect(registry.resolve('ConsumoAnomaloDetectadoEvent')).toBe(consumoAnomaloHandler);
    expect(registry.resolve('NoExisteEvent')).toBeNull();
  });

  test('los eventos sin aviso no tienen handler', () => {
    const registry = createEventHandlerRegistry();
    for (const eventType of IGNORED_EVENT_TYPES) {
      expect(registry.resolve(eventType)).toBeNull();
    }
  });
});
