// HL7 timestamps (`DTM`) in and out.
//
// Everything here works in local wall-clock time. SyncTool's `ExamPayload.date` is a zone-less
// `yyyyMMddHHmmss` string, and an analyzer and the SyncTool machine it reports to sit in the same
// clinic, so they share a wall clock. No timezone conversion is done anywhere in this module.

const pad = (value: number, width = 2): string => String(value).padStart(width, '0')

/**
 * Local time as `yyyyMMddHHmmss` (the `ExamPayload.date` format, also fine for MSH-7).
 * The year is always padded to four digits.
 */
export const hl7Timestamp = (date: Date): string => [
  pad(date.getFullYear(), 4),
  pad(date.getMonth() + 1),
  pad(date.getDate()),
  pad(date.getHours()),
  pad(date.getMinutes()),
  pad(date.getSeconds()),
].join('')

/**
 * Local time as `YYYYMMDDHHMMSS±ZZZZ`, for peers that want an explicit UTC offset (in an ACK's
 * MSH-7, for example).
 *
 * `Date#getTimezoneOffset()` has the opposite sign to HL7 (UTC+9 returns -540), so it is negated
 * first.
 */
export const hl7TimestampWithOffset = (date: Date): string => {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes < 0 ? '-' : '+'
  const absolute = Math.abs(offsetMinutes)

  return `${hl7Timestamp(date)}${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`
}

/**
 * An HL7 timestamp → `yyyyMMddHHmmss`, or `undefined` when fewer than 14 digits are available.
 *
 * Steps: trim; strip a trailing UTC offset (`+0800`, `-0500`, `+08:00`); drop every remaining
 * non-digit; keep the first 14 digits. That accepts the plain form (`20230615170942`), an offset
 * (`20230615170942+0800`), fractional seconds (`20230615170942.123`), separators
 * (`2023-06-15 17:09:42`) and a stray trailing character (`20131001093000l`).
 *
 * The offset is stripped before the digits are collected so that it can never be mistaken for
 * seconds: `202306151709+0800` (minute precision plus an offset) yields `undefined`, not
 * `20230615170908`.
 *
 * **No timezone conversion** (see the module header): the analyzer's wall-clock time is taken as
 * reported. A value with fewer than 14 digits (a date-only `YYYYMMDD`, a minute-precision time)
 * yields `undefined`, so the caller can fall back to its next source instead of recording a
 * made-up time of day.
 */
export const normalizeHl7Date = (raw: string | undefined): string | undefined => {
  const digits = String(raw ?? '')
    .trim()
    .replace(/[+-]\d{2}:?\d{2}$/, '')
    .replace(/\D/g, '')

  return digits.length >= 14 ? digits.slice(0, 14) : undefined
}
