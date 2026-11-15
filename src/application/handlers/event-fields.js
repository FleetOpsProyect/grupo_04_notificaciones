const { z } = require('zod');

const identifier = z.string().trim().min(1).max(128);
const optionalIdentifier = identifier.optional();
const shortText = z.string().trim().min(1).max(100);
const optionalShortText = shortText.optional();
const mediumText = z.string().trim().min(1).max(200);
const optionalMediumText = mediumText.optional();
const emailText = z.string().trim().min(1).max(254);
const isoDate = (message) =>
  z
    .string()
    .trim()
    .max(100)
    .refine((value) => !Number.isNaN(Date.parse(value)), { message });
const optionalIsoDate = (message) => isoDate(message).optional();

module.exports = {
  identifier,
  optionalIdentifier,
  shortText,
  optionalShortText,
  mediumText,
  optionalMediumText,
  emailText,
  isoDate,
  optionalIsoDate,
};
