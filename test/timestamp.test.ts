// Unit tests for src/timestamp.ts: HL7 timestamps in and out.
//
// Dates are always built in the local timezone of the test machine, so the expectations hold
// on any machine. Only node:test and node:assert/strict are used.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hl7Timestamp, hl7TimestampWithOffset, normalizeHl7Date } from '../src/timestamp.ts'

/** The `±HHMM` suffix `hl7TimestampWithOffset` must produce for `date`, computed independently. */
const expectedOffset = (date: Date): string => {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes < 0 ? '-' : '+'
  const absolute = Math.abs(offsetMinutes)

  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}${String(absolute % 60).padStart(2, '0')}`
}

describe('normalizeHl7Date', () => {
  it('returns a standard 14-digit value unchanged', () => {
    assert.equal(normalizeHl7Date('20230615170942'), '20230615170942')
  })

  it('filters out extra digits and stray characters, keeping the first 14 digits', () => {
    // A stray trailing character after the seconds.
    assert.equal(normalizeHl7Date('2013100109300000l'), '20131001093000')
    assert.equal(normalizeHl7Date('20230615170942+0800'), '20230615170942')
    assert.equal(normalizeHl7Date('2023-06-15 17:09:42'), '20230615170942')
  })

  it('returns undefined whenever 14 digits cannot be collected (so the caller falls back)', () => {
    assert.equal(normalizeHl7Date('20230615'), undefined)
    assert.equal(normalizeHl7Date(''), undefined)
    assert.equal(normalizeHl7Date(undefined), undefined)
  })

  it('strips the UTC offset and keeps the first 14 digits', () => {
    assert.equal(normalizeHl7Date('20250310131500+0900'), '20250310131500')
    assert.equal(normalizeHl7Date('20250310131500-0500'), '20250310131500')
    assert.equal(normalizeHl7Date('20250313142303+0900'), '20250313142303')
    assert.equal(normalizeHl7Date('20250310131500'), '20250310131500')
    assert.equal(normalizeHl7Date('  20250310131500+0900  '), '20250310131500')
  })

  it('returns undefined for too few digits or an empty value', () => {
    assert.equal(normalizeHl7Date('20250310'), undefined)
    assert.equal(normalizeHl7Date('202503101315'), undefined)
    assert.equal(normalizeHl7Date(''), undefined)
    assert.equal(normalizeHl7Date(undefined), undefined)
  })

  it('never reads a UTC offset as seconds: minute precision plus an offset yields undefined', () => {
    assert.equal(normalizeHl7Date('202306151709+0800'), undefined)
    assert.equal(normalizeHl7Date('202306151709-0500'), undefined)
    assert.equal(normalizeHl7Date('202306151709+08:00'), undefined)
  })

  it('accepts an offset written with a colon', () => {
    assert.equal(normalizeHl7Date('20230615170942+08:00'), '20230615170942')
    assert.equal(normalizeHl7Date('20230615170942-05:30'), '20230615170942')
  })

  it('accepts fractional seconds, with or without an offset', () => {
    assert.equal(normalizeHl7Date('20230615170942.123'), '20230615170942')
    assert.equal(normalizeHl7Date('20230615170942.1234+0800'), '20230615170942')
  })

  it('does no timezone conversion: the wall-clock digits are kept as reported', () => {
    assert.equal(normalizeHl7Date('20231231235959-1200'), '20231231235959')
    assert.equal(normalizeHl7Date('20240101000000+1400'), '20240101000000')
  })
})

describe('hl7Timestamp', () => {
  it('formats local time as yyyyMMddHHmmss with zero padding', () => {
    assert.equal(hl7Timestamp(new Date(2026, 8, 4, 9, 5, 3)), '20260904090503')
    assert.match(hl7Timestamp(new Date()), /^\d{14}$/)
  })

  it('formats a second local time as yyyyMMddHHmmss', () => {
    const date = new Date(2025, 2, 10, 13, 15, 0)

    assert.equal(hl7Timestamp(date), '20250310131500')
  })

  it('pads a year below 1000 to four digits', () => {
    assert.equal(hl7Timestamp(new Date(999, 0, 2, 3, 4, 5)), '09990102030405')
    assert.equal(hl7Timestamp(new Date(999, 0, 2, 3, 4, 5)).length, 14)
  })
})

describe('hl7TimestampWithOffset', () => {
  it('formats local time as YYYYMMDDHHMMSS±ZZZZ', () => {
    const date = new Date(2025, 2, 10, 13, 15, 0)
    const text = hl7TimestampWithOffset(date)

    assert.match(text, /^\d{14}[+-]\d{4}$/)
    assert.equal(text.slice(0, 14), '20250310131500')
    // The offset must match what Date itself reports (the test machine's zone is not fixed).
    assert.equal(text.slice(14), expectedOffset(date))
  })

  it('uses the padded four-digit year as well', () => {
    const date = new Date(999, 0, 2, 3, 4, 5)
    const text = hl7TimestampWithOffset(date)

    assert.equal(text.slice(0, 14), '09990102030405')
    assert.equal(text.slice(14), expectedOffset(date))
  })

  it('round-trips through normalizeHl7Date', () => {
    const date = new Date(2025, 2, 10, 13, 15, 0)

    assert.equal(normalizeHl7Date(hl7TimestampWithOffset(date)), hl7Timestamp(date))
  })
})
