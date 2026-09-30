# @nxvet/nxst-hl7-parser

English · [Traditional Chinese](README.zh.md)

Instrument-agnostic **HL7 v2.x and MLLP helpers** for NxVet SyncTool device plugins: MLLP framing,
segment / field / component access, and HL7 timestamps.

- **Pure functions, zero I/O, zero runtime dependencies.** Nothing is imported from `node:*`; the
  only runtime API used is the global `Buffer`.
- **Tolerant by design.** Every tolerance rule below comes from messages seen in the field, and
  each one is pinned by a unit test.
- **Built for single-file plugin bundles.** Plugins built with
  [`@nxvet/nxst-plugin`](https://www.npmjs.com/package/@nxvet/nxst-plugin) inline this package into
  their `main.cjs`, so the `.nxplugin` stays self-contained.

What this package deliberately does **not** know about: which field carries the patient id, which
OBX rows are results, what a QC message looks like, or how a given analyzer wants its ACK header laid
out. Those are instrument semantics and stay in each plugin.

---

## Installation

```bash
npm install @nxvet/nxst-hl7-parser
```

Requires **Node 22 or newer**. The package is ESM and ships compiled JavaScript with type
declarations (`dist/*.js` + `dist/*.d.ts`). Bundlers such as esbuild handle it directly; plain
CommonJS code can `require()` it on Node versions with `require(esm)` support (22.12 and later).

## Quick start

A minimal MLLP receiver: accumulate bytes per connection, cut out complete frames, read a few
fields, answer with an ACK.

```ts
import type { Hl7Segment } from '@nxvet/nxst-hl7-parser'
import {
  extractMllpFrames,
  field,
  findSegment,
  hl7Timestamp,
  normalizeHl7Date,
  parseMessage,
  sanitizeHl7Text,
  wrapMllp,
} from '@nxvet/nxst-hl7-parser'

let pending: Buffer = Buffer.alloc(0)

const onData = (chunk: Uint8Array): Uint8Array[] => {
  const { frames, rest, discarded } = extractMllpFrames(Buffer.concat([pending, Buffer.from(chunk)]))

  pending = rest // keep the unfinished tail for the next chunk
  if (discarded > 0) console.debug(`dropped ${discarded} byte(s) outside any frame`) // count only, never content

  return frames.map((text) => {
    const segments: Hl7Segment[] = parseMessage(text)
    const msh = findSegment(segments, 'MSH')
    const obr = findSegment(segments, 'OBR')

    const controlId = field(msh, 10).trim() // MSH-10, numbered as in the spec
    const observedAt = normalizeHl7Date(field(obr, 7)) ?? normalizeHl7Date(field(msh, 7))

    // ... build your result from the OBX segments ...

    const ack = [
      `MSH|^~\\&|LIS||${field(msh, 3)}|${field(msh, 4)}|${hl7Timestamp(new Date())}||ACK|1|P|2.4`,
      `MSA|AA|${controlId}|${sanitizeHl7Text('Message accepted.')}`,
    ].join('\r')

    return wrapMllp(`${ack}\r`)
  })
}
```

## API

### MLLP

| Export | Description |
|---|---|
| `MLLP_START` | `0x0B`, `<SB>`: the first byte of every frame. |
| `MLLP_END` | `0x1C`, `<EB>`: the byte that closes a frame. |
| `MLLP_CR` | `0x0D`, `<CR>`: normally follows `<EB>`. |
| `interface MllpExtraction` | `{ frames: string[], rest: Buffer, discarded: number }` |
| `extractMllpFrames(buffer: Buffer): MllpExtraction` | Cuts every complete frame out of the accumulated bytes. |
| `wrapMllp(text: string): Uint8Array` | `<SB>` + UTF-8 text + `<EB><CR>`. |

`extractMllpFrames` rules:

- A chunk may hold several frames; a frame may span several chunks. The unfinished tail is returned
  in `rest`; prepend it to the next chunk. `rest` is either empty or starts with `<SB>`.
- `rest` is an independent copy, not a view into `buffer`, so keeping it does not keep a large input
  buffer alive.
- Bytes before `<SB>` are noise (boot-up output, a stray byte from the previous frame). They are
  dropped and **counted** in `discarded`; their content is never returned, so it cannot leak into a
  log.
- A `<CR>` right after `<EB>` is consumed. A missing `<CR>` is tolerated. A `<CR>` that arrives late,
  at the start of the next chunk, is dropped as one byte of noise, which is harmless because the
  frame was already emitted.
- Frame content is decoded as UTF-8.

### Message structure

| Export | Description |
|---|---|
| `interface Hl7Segment` | `{ name: string, fields: string[] }`; `fields[0]` is the segment name. |
| `parseMessage(text: string): Hl7Segment[]` | Splits a message into segments and fields. |
| `field(segment: Hl7Segment \| undefined, n: number): string` | Field `n`, numbered as in the HL7 spec. |
| `component(value: string, index: number): string` | Component `index` (1-based) of a `^`-separated value. |
| `findSegment(segments, name): Hl7Segment \| undefined` | The first segment with that name. |
| `findSegments(segments, name): Hl7Segment[]` | Every segment with that name, in message order. |
| `sanitizeHl7Text(text: string): string` | Makes free text safe to put inside a field. |

Rules:

- **Segment terminators**: `\r` (standard), `\r\n` and `\n` are all accepted, even mixed in one
  message.
- **Whole-line trim**: each line is trimmed (spaces, tabs) before it is split on `|`. `|` is not
  whitespace, so the field structure never changes; only whitespace at the very start of the first
  field and the very end of the last field is removed. Whitespace inside a field is kept.
- **Blank lines** (a trailing terminator, empty or whitespace-only lines) are skipped.
- **Segment names are trimmed**, so `PID |...` is still found as `PID`.
- **MSH offset**: in MSH the field separator itself is MSH-1, so `MSH-n = fields[n-1]`; in every
  other segment `SEG-n = fields[n]`. `field()` applies the offset for you: `field(msh, 10)` is
  MSH-10 and `field(obx, 5)` is OBX-5.
- **Never `undefined`**: `field()` returns `''` for a missing segment or a field that was not sent;
  `component()` returns `''` for an index past the end, and a value without `^` is its own first
  component.
- **Default delimiters only**: fields split on `|`, components on `^`. Repetitions (`~`),
  sub-components (`&`) and escape sequences (`\F\`, `\S\`, ...) are returned as-is, not decoded.
- `sanitizeHl7Text` replaces `|`, `^`, `~`, `\`, `&`, `\r` and `\n` with spaces and trims the result.
  Use it for any text you did not write yourself (an error message placed in MSA-3, for example).

### Timestamps

| Export | Description |
|---|---|
| `hl7Timestamp(date: Date): string` | Local time as `yyyyMMddHHmmss`. |
| `hl7TimestampWithOffset(date: Date): string` | Local time as `YYYYMMDDHHMMSS±ZZZZ`. |
| `normalizeHl7Date(raw: string \| undefined): string \| undefined` | An HL7 timestamp → `yyyyMMddHHmmss`, or `undefined`. |

Rules:

- Everything works in **local wall-clock time**; there is no timezone conversion anywhere. SyncTool's
  `ExamPayload.date` is a zone-less `yyyyMMddHHmmss`, and an analyzer and the SyncTool machine it
  reports to share a clinic's wall clock.
- `hl7Timestamp` always pads the year to four digits.
- `hl7TimestampWithOffset` inverts the sign of `Date#getTimezoneOffset()` (UTC+9 is `+0900`).
- `normalizeHl7Date`: trim → strip a trailing UTC offset (`+0800`, `-0500`, `+08:00`) → drop every
  other non-digit → keep the first 14 digits. Fewer than 14 digits yields `undefined`, so the caller
  can fall back to its next source.

| Input | Result |
|---|---|
| `20230615170942` | `20230615170942` |
| `20230615170942+0800`, `20230615170942+08:00` | `20230615170942` |
| `20230615170942.123` (fractional seconds) | `20230615170942` |
| `2023-06-15 17:09:42` | `20230615170942` |
| `20131001093000l` (stray trailing character) | `20131001093000` |
| `202306151709+0800` (minute precision + offset) | `undefined` (the offset is never read as seconds) |
| `20230615` (date only), `''`, `undefined` | `undefined` |

## Using it in a SyncTool plugin

Declare it under `dependencies` (a `^1.x` range) and import it like any other module. The
`nxst-plugin build` step bundles it into `dist/main.cjs`, so the `.nxplugin` remains a single
self-contained file, and since the package imports nothing from `node:*`, the bundle's `require`
allow-list is unaffected. Keep instrument semantics in the plugin's own `protocol.ts`, and never copy
this package's code into a plugin: fixes belong here, followed by a release and a dependency bump.
The Traditional Chinese README has a fuller guide for plugin authors, including local
co-development.

## Development

```bash
npm ci
npm test              # builds dist/, type-checks src/ and test/, then runs the tests
npm pack --dry-run    # shows exactly what would be published
```

Tests use only the Node.js built-in runner (`node:test`) and `node:assert/strict`, and run the
TypeScript sources directly through Node's type stripping. Source files therefore stay within
what type stripping accepts: no `enum`, `namespace` or constructor parameter properties, `import
type` for type-only imports, and relative imports written with their `.ts` extension (rewritten to
`.js` at build time). `test/exports.test.ts` imports the package by its own name, which goes through
the `exports` map to the built `dist/`, so a broken entry point fails the test suite.

### Releasing

1. Bump `version` in `package.json` and add an entry to `CHANGELOG.md`.
2. Commit, then tag `vX.Y.Z` (the tag must equal the `package.json` version) and push the tag.
3. The `release` workflow builds, tests, smoke-installs the packed tarball, publishes to npm with
   provenance through npm trusted publishing (prereleases such as `v1.1.0-rc.0` go to the `rc`
   dist-tag), and attaches the tarball to a GitHub Release.

A published version is never overwritten: if a release turns out to be wrong, publish a new version.

## Versioning

The package follows [semantic versioning](https://semver.org/). The public API is the set of runtime
exports and the two types listed above. Any change to what an existing function returns for a given
input is recorded in [CHANGELOG.md](CHANGELOG.md); a change that could alter results consumers
already rely on is a major version.

## License

[Apache-2.0](LICENSE)
