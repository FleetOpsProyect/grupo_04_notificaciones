const BOGOTA_SUFFIX = '-05:00';
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const bogotaFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const partsToMap = (parts) =>
  parts.reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});

const formatBogotaIso = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = partsToMap(bogotaFormatter.formatToParts(date));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${BOGOTA_SUFFIX}`;
};

const formatBogotaText = (value) => {
  const iso = formatBogotaIso(value);
  if (iso === null) {
    return 'fecha no disponible';
  }
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} (GMT-5)`;
};

const isIsoDateTime = (value) =>
  typeof value === 'string' &&
  ISO_DATE_TIME_PATTERN.test(value) &&
  !Number.isNaN(Date.parse(value));

const parseIsoDate = (value) => {
  if (!isIsoDateTime(value)) {
    return null;
  }
  return new Date(value);
};

module.exports = { formatBogotaIso, formatBogotaText, isIsoDateTime, parseIsoDate };
