# Guía de contribución

**Estado:** Vigente
**Última actualización:** 2026-11-14
**Función:** Flujo de trabajo del repositorio

Este documento centraliza las reglas de ramas, commits y pull requests del proyecto.

## 1. Ramas

### Ramas principales

- `develop`: integración de cambios.
- `main`: versión desplegable.

No se hace push directo a `develop` ni a `main`.

### Ramas de trabajo

Se crean desde `develop`:

| Prefijo           | Uso                                   | Ejemplo                            |
| ----------------- | ------------------------------------- | ---------------------------------- |
| `feat/<slug>`     | Funcionalidad o cambio técnico sin HU | `feat/fallback-500`                |
| `hu/HU-XX-<slug>` | Historia de usuario                   | `hu/HU-03-recordatorio-documentos` |
| `fix/<slug>`      | Corrección rápida de bug              | `fix/region-sqs`                   |

Reglas:

- Minúsculas, sin espacios, sin tildes y con guiones.
- Máximo aproximado: 50 caracteres.
- Una rama por cambio.
- Se elimina después del merge.

## 2. Commits

Formato:

```text
tipo(alcance opcional): descripción en español
```

Tipos permitidos:

- `feat`
- `fix`
- `docs`
- `test`
- `refactor`
- `chore`
- `perf`
- `ci`

Ejemplos:

```text
feat(api): agregar límite de offset
fix(firestore): corregir fallback de listado
docs(operacion): agregar runbook de DLQ
test: cubrir métricas de eventos desconocidos
chore: configurar dependabot
```

Reglas:

- La descripción va en español, en imperativo y en minúscula.
- Sin punto final.
- Máximo 72 caracteres en la primera línea.
- El cuerpo es opcional y explica el porqué.
- Si aplica, referenciar la HU en el cuerpo: `Refs: HU-03`.

## 3. Pull requests

- Se abren desde la rama de trabajo hacia `develop`.
- El título sigue el mismo formato del commit principal.
- La descripción debe incluir qué cambió, por qué y cómo se verificó.
- Se debe enlazar la HU cuando aplique.
- No se mergea sin CI en verde.
- Para release: PR de `develop` hacia `main`.

## 4. Checklist de PR

- [ ] Rama creada desde `develop` con el prefijo correcto.
- [ ] Commits en español y con el formato acordado.
- [ ] Pruebas ejecutadas.
- [ ] Lint y formato correctos.
- [ ] OpenAPI validado si cambió la API.
- [ ] Documentación actualizada si aplica.
- [ ] Sin secretos, credenciales ni datos personales.
- [ ] PR dirigido a `develop`.

## 5. Flujo de trabajo

```text
1. Crear rama desde develop:
   feat/<slug>
   hu/HU-XX-<slug>
   fix/<slug>

2. Hacer commits en español.

3. Push de la rama.

4. Abrir PR hacia develop.

5. CI valida lint, formato, OpenAPI, pruebas, SQS y Sonar.

6. Merge a develop.

7. PR develop -> main para release.

8. CD despliega en EC2.
```

## 6. Buenas prácticas

- Mantener ramas cortas y enfocadas.
- Evitar mezclar cambios no relacionados.
- No reescribir historia compartida.
- No hacer force push sobre ramas con PR abierto.
- Revisar el diff antes de abrir el PR.
- Mantener el PR pequeño y fácil de revisar.

## 7. Documentación relacionada

- [`README.md`](./README.md)
- [`docs/README.md`](./docs/README.md)
