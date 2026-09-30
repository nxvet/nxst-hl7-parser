// Unit tests for src/message.ts: segment splitting, the MSH field offset, components,
// segment lookup and free-text sanitising.
//
// All messages below are synthetic. Only node:test and node:assert/strict are used.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { component, field, findSegment, findSegments, parseMessage, sanitizeHl7Text } from '../src/message.ts'

describe('parseMessage', () => {
  it('splits segments on \\r; fields[0] is the segment name', () => {
    const segments = parseMessage('MSH|^~\\&|APP\rPID|1|002\rOBX|1|ST|0|pH|7.4')

    assert.deepEqual(segments.map((segment) => segment.name), ['MSH', 'PID', 'OBX'])
    assert.equal(segments[0].fields[0], 'MSH')
    assert.equal(segments[1].fields[2], '002')
  })

  it('tolerates \\r\\n and \\n and skips blank segments', () => {
    const segments = parseMessage('MSH|A\r\nPID|1\n\r\nOBX|1\r')

    assert.deepEqual(segments.map((segment) => segment.name), ['MSH', 'PID', 'OBX'])
  })

  it('accepts \\r, \\r\\n and \\n in one message, drops empty lines and keeps the field split', () => {
    const segments = parseMessage('MSH|A\r\nPID|B\n\rOBX|C\r')

    assert.deepEqual(segments.map((segment) => segment.name), ['MSH', 'PID', 'OBX'])
    assert.deepEqual(segments[1].fields, ['PID', 'B'])
  })

  it('trims each whole line (spaces and tabs at either end) before splitting it into fields', () => {
    const segments = parseMessage('  MSH|^~\\&|APP  \r\tPID|1|002\t\r OBX|1|NM|GLU||5.4 \r')
    const [msh, pid, obx] = segments

    assert.deepEqual(segments.map((segment) => segment.name), ['MSH', 'PID', 'OBX'])
    assert.equal(msh.fields[0], 'MSH')
    assert.equal(field(msh, 3), 'APP')
    assert.deepEqual(pid.fields, ['PID', '1', '002'])
    assert.deepEqual(obx.fields, ['OBX', '1', 'NM', 'GLU', '', '5.4'])
  })

  it('only trims the ends of a line: whitespace inside a field and empty fields are kept', () => {
    const [obx] = parseMessage('OBX|1| |NM| a b ||x')

    assert.deepEqual(obx.fields, ['OBX', '1', ' ', 'NM', ' a b ', '', 'x'])
    assert.equal(field(obx, 2), ' ')
    assert.equal(field(obx, 4), ' a b ')
    assert.equal(field(obx, 5), '')
  })

  it('skips lines that contain only whitespace', () => {
    const segments = parseMessage('MSH|A\r   \r\t\r\n \nPID|1')

    assert.deepEqual(segments.map((segment) => segment.name), ['MSH', 'PID'])
  })

  it('trims the segment name, so a name padded before its first | is still found', () => {
    const segments = parseMessage('MSH|A\rPID |1|002')

    assert.equal(segments[1].name, 'PID')
    assert.equal(field(findSegment(segments, 'PID'), 2), '002')
  })

  it('returns no segments for an empty or whitespace-only message', () => {
    assert.deepEqual(parseMessage(''), [])
    assert.deepEqual(parseMessage('\r\n \t\r'), [])
  })
})

describe('field', () => {
  describe('with an ORU^R01-shaped message', () => {
    const message = 'MSH|^~\\&|APP|MODEL^SN0001|LIS||20241217130806||ORU^R01|15|P|2.4||||1||UNICODE UTF-8\rPID|1|002|||Test Patient||19900101|M\rOBR|||S-0001|BG^Blood gas|||20230615170942||||||||Arterial|admin'
    const segments = parseMessage(message)
    const msh = findSegment(segments, 'MSH')
    const pid = findSegment(segments, 'PID')
    const obr = findSegment(segments, 'OBR')

    it('reads MSH-n from fields[n-1]', () => {
      assert.equal(field(msh, 2), '^~\\&')
      assert.equal(field(msh, 3), 'APP')
      assert.equal(field(msh, 4), 'MODEL^SN0001')
      assert.equal(field(msh, 5), 'LIS')
      assert.equal(field(msh, 6), '')
      assert.equal(field(msh, 7), '20241217130806')
      assert.equal(field(msh, 9), 'ORU^R01')
      assert.equal(field(msh, 10), '15')
      assert.equal(field(msh, 12), '2.4')
      assert.equal(field(msh, 16), '1')
      assert.equal(field(msh, 18), 'UNICODE UTF-8')
    })

    it('reads SEG-n from fields[n] in every other segment', () => {
      assert.equal(field(pid, 2), '002')
      assert.equal(field(pid, 3), '')
      assert.equal(field(pid, 5), 'Test Patient')
      assert.equal(field(pid, 8), 'M')
      assert.equal(field(obr, 3), 'S-0001')
      assert.equal(field(obr, 4), 'BG^Blood gas')
      assert.equal(field(obr, 7), '20230615170942')
      assert.equal(field(obr, 15), 'Arterial')
      assert.equal(field(obr, 16), 'admin')
    })

    it('returns an empty string for a missing segment or a field that was not sent', () => {
      assert.equal(field(undefined, 3), '')
      assert.equal(field(msh, 99), '')
      assert.equal(field(obr, 47), '')
    })
  })

  it('shifts the index for MSH only (OUL^R22-shaped MSH and OBX)', () => {
    const segments = parseMessage([
      'MSH|^~\\&|Analyzer^v1.2.3||||20250310104500+0900||OUL^R22^OUL_R22|00000000-0000-4000-8000-000000000001|P|2.6|||NE|AL||UNICODE UTF-8',
      'OBX|1|NM|GLU01^GLU^LOCAL||< 10|mg/dL|74-146||||F|||20250313142303+0900||admin',
    ].join('\r'))

    const msh = segments[0]
    const obx = segments[1]

    assert.equal(field(msh, 3), 'Analyzer^v1.2.3')
    assert.equal(field(msh, 7), '20250310104500+0900')
    assert.equal(field(msh, 9), 'OUL^R22^OUL_R22')
    assert.equal(field(msh, 10), '00000000-0000-4000-8000-000000000001')
    assert.equal(field(msh, 12), '2.6')
    assert.equal(field(msh, 18), 'UNICODE UTF-8')

    assert.equal(field(obx, 2), 'NM')
    assert.equal(field(obx, 3), 'GLU01^GLU^LOCAL')
    assert.equal(field(obx, 5), '< 10')
    assert.equal(field(obx, 7), '74-146')
    assert.equal(field(obx, 11), 'F')
    assert.equal(field(obx, 16), 'admin')
  })

  it('returns an empty string for a missing segment or a field that was not sent (SPM)', () => {
    const segments = parseMessage('SPM|1|||Plasma|||||||P')

    assert.equal(field(undefined, 11), '')
    assert.equal(field(segments[0], 4), 'Plasma')
    assert.equal(field(segments[0], 11), 'P')
    assert.equal(field(segments[0], 30), '')
  })
})

describe('component', () => {
  it('is 1-based', () => {
    assert.equal(component('AB^CD', 1), 'AB')
    assert.equal(component('AB^CD', 2), 'CD')
    assert.equal(component('57^111', 2), '111')
  })

  it('treats a value without ^ as its own first component; an index past the end yields an empty string', () => {
    assert.equal(component('A24-0917', 1), 'A24-0917')
    assert.equal(component('A24-0917', 2), '')
    assert.equal(component('', 1), '')
  })

  it('is 1-based across empty components; an index past the end yields an empty string', () => {
    assert.equal(component('P000123^^^^^Example Clinic', 1), 'P000123')
    assert.equal(component('P000123^^^^^Example Clinic', 6), 'Example Clinic')
    assert.equal(component('P000123^^^^^Example Clinic', 2), '')
    assert.equal(component('NoComponents', 1), 'NoComponents')
    assert.equal(component('NoComponents', 2), '')
    assert.equal(component('', 1), '')
  })
})

describe('findSegment / findSegments', () => {
  const segments = parseMessage('MSH|A\rOBX|1\rOBX|2\rOBX|3')

  it('findSegment returns the first match, or undefined', () => {
    assert.equal(field(findSegment(segments, 'OBX'), 1), '1')
    assert.equal(findSegment(segments, 'PID'), undefined)
  })

  it('findSegments returns every match in message order', () => {
    assert.deepEqual(findSegments(segments, 'OBX').map((segment) => field(segment, 1)), ['1', '2', '3'])
    assert.deepEqual(findSegments(segments, 'PID'), [])
  })

  it('handle repeated NTE segments and names that do not occur', () => {
    const notes = parseMessage('MSH|A\rNTE|1|L|1^Lot1\rNTE|2|L|2^20251231\rOBX|1')

    assert.equal(findSegment(notes, 'MSH')?.fields[0], 'MSH')
    assert.equal(findSegment(notes, 'SAC'), undefined)
    assert.equal(findSegments(notes, 'NTE').length, 2)
    assert.deepEqual(findSegments(notes, 'ZZZ'), [])
  })
})

describe('sanitizeHl7Text', () => {
  it('replaces delimiters and line breaks with spaces so that no malformed message is built', () => {
    assert.equal(sanitizeHl7Text('bad|text^with~escapes\\&\r\nhere'), 'bad text with escapes    here')
    assert.equal(sanitizeHl7Text('Message accepted.'), 'Message accepted.')
  })

  it('trims the result and leaves an empty string empty', () => {
    assert.equal(sanitizeHl7Text('|Message rejected: bad field|\r'), 'Message rejected: bad field')
    assert.equal(sanitizeHl7Text('  \n'), '')
    assert.equal(sanitizeHl7Text(''), '')
  })

  it('produces text that parses back as a single field', () => {
    const text = sanitizeHl7Text('line one\rMSH|^~\\&|FAKE')
    const [msa] = parseMessage(`MSA|AE|15|${text}`)

    assert.equal(msa.fields.length, 4)
    assert.equal(field(msa, 3), 'line one MSH      FAKE')
  })
})
