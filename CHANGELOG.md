# Changelog

All notable changes to `@nxvet/nxst-hl7-parser` are recorded here. The package follows
[semantic versioning](https://semver.org/); see "Versioning" in the README for what counts as a
breaking change.

## 1.0.0 — 2026-09-30

Initial release.

- **MLLP**: `MLLP_START`, `MLLP_END`, `MLLP_CR`, `extractMllpFrames`, `wrapMllp`, and the
  `MllpExtraction` type.
- **Message structure**: `parseMessage`, `field`, `component`, `findSegment`, `findSegments`,
  `sanitizeHl7Text`, and the `Hl7Segment` type.
- **Timestamps**: `hl7Timestamp`, `hl7TimestampWithOffset`, `normalizeHl7Date`.

These helpers previously existed as two separately maintained copies inside NxVet's official
SyncTool device plugins. This release merges them into one package with the same names and
signatures. Where the two copies behaved differently, the more tolerant behaviour was kept:

- `extractMllpFrames` returns `rest` as an independent copy rather than a view into the input
  buffer. The extracted frames are unchanged.
- `parseMessage` trims every whole line before splitting it into fields, skips blank lines, and
  trims the segment name.
- `hl7Timestamp` always pads the year to four digits.
- `normalizeHl7Date` strips a trailing UTC offset (`±HHMM` or `±HH:MM`) before collecting digits.
  **Behaviour change for one of the previous copies:** a minute-precision value with an offset,
  such as `202306151709+0800`, used to come out as `20230615170908` (the offset misread as seconds)
  and now yields `undefined`, so callers fall back to their next timestamp source. Values with full
  seconds are unaffected.
