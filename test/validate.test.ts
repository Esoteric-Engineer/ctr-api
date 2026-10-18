import { describe, expect, it } from 'vitest'
import { FILE_RULES, PREVIEW_RULES, checkFile, checkPreview, checkSca, readPreview, sha256Hex } from '../src/validate'
import { DHT, JFIF_APP0, PNG_SIGNATURE, bytesOfSize, file, jpeg, png, replaceChunk, sca, scaChunks, utf8 } from './fixtures'

const bufferOf = (bytes: Uint8Array<ArrayBuffer>) => bytes.buffer

describe('sha256Hex', () => {
  it('returns lowercase hex digests', async () => {
    expect(await sha256Hex(utf8('abc').buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex(new ArrayBuffer(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('checkFile', () => {
  it('accepts files with the right extension, case-insensitively', () => {
    expect(checkFile('lev', file(bytesOfSize(10), 'track.lev'))).toBeNull()
    expect(checkFile('vrm', file(bytesOfSize(10), 'TRACK.VRM'))).toBeNull()
    expect(checkFile('sca', file(bytesOfSize(10), 'song.Sca'))).toBeNull()
  })

  it('rejects files with the wrong extension', () => {
    expect(checkFile('lev', file(bytesOfSize(10), 'track.vrm'))).toBe('The lev file must have a .lev extension')
    expect(checkFile('lev', file(bytesOfSize(10), 'track.lev.exe'))).toBe('The lev file must have a .lev extension')
    expect(checkFile('sca', file(bytesOfSize(10), 'sca'))).toBe('The sca file must have a .sca extension')
  })

  it('rejects empty files', () => {
    expect(checkFile('vrm', file(new Uint8Array(0), 'track.vrm'))).toBe('The .vrm file is empty')
  })

  it.each([
    ['lev', '2048 KB'],
    ['vrm', '1280 KB'],
    ['sca', '512 KB'],
  ] as const)('enforces the %s size limit (%s)', (kind, label) => {
    const max = FILE_RULES[kind].maxBytes
    expect(checkFile(kind, file(bytesOfSize(max), `x.${kind}`))).toBeNull()
    expect(checkFile(kind, file(bytesOfSize(max + 1), `x.${kind}`))).toBe(`The .${kind} file is too large (max ${label})`)
  })
})

describe('checkPreview', () => {
  describe('PNG', () => {
    it('reads the dimensions from IHDR', () => {
      expect(checkPreview(bufferOf(png(640, 360)))).toEqual({ type: 'image/png', ext: 'png', width: 640, height: 360 })
    })

    it('rejects truncated files', () => {
      expect(checkPreview(bufferOf(png(640, 360).slice(0, 30)))).toBe('Invalid PNG: file is truncated')
    })

    it('rejects files without IHDR as the first chunk', () => {
      const bytes = png(640, 360)
      bytes.set([0x49, 0x44, 0x41, 0x54], 12)
      expect(checkPreview(bufferOf(bytes))).toBe('Invalid PNG: missing IHDR chunk')
    })

    it('rejects files that do not end with IEND', () => {
      expect(checkPreview(bufferOf(png(640, 360).slice(0, -1)))).toBe('Invalid PNG: file is truncated (missing IEND chunk)')
    })
  })

  describe('JPEG', () => {
    it.each([
      ['baseline', 0xc0],
      ['extended sequential', 0xc1],
      ['progressive', 0xc2],
    ])('reads the dimensions of %s images', (_, sof) => {
      expect(checkPreview(bufferOf(jpeg(800, 450, { sof })))).toEqual({ type: 'image/jpeg', ext: 'jpg', width: 800, height: 450 })
    })

    it('skips non-frame segments such as DHT that share the SOF marker range', () => {
      expect(checkPreview(bufferOf(jpeg(800, 450, { before: [...JFIF_APP0, ...DHT] })))).toMatchObject({ width: 800, height: 450 })
    })

    it('skips fill bytes and standalone markers', () => {
      expect(checkPreview(bufferOf(jpeg(800, 450, { before: [0xff, 0xff, 0xff, 0x01, ...JFIF_APP0] })))).toMatchObject({ width: 800, height: 450 })
    })

    it.each([0xc3, 0xc5, 0xc9, 0xcb, 0xcf])('rejects unsupported encodings (SOF marker 0x%s)', (sof) => {
      expect(checkPreview(bufferOf(jpeg(800, 450, { sof })))).toBe('Unsupported JPEG encoding (use baseline or progressive)')
    })

    it('rejects image data before any frame header', () => {
      const bytes = new Uint8Array([0xff, 0xd8, ...JFIF_APP0, 0xff, 0xda, 0x00, 0x02, 0x00, 0x00])
      expect(checkPreview(bufferOf(bytes))).toBe('Invalid JPEG: no frame header before image data')
    })

    it('rejects an end-of-image marker before any frame header', () => {
      expect(checkPreview(bufferOf(new Uint8Array([0xff, 0xd8, ...JFIF_APP0, 0xff, 0xd9, 0x00, 0x00])))).toBe('Invalid JPEG: no frame header before image data')
    })

    it('rejects garbage where a marker is expected', () => {
      expect(checkPreview(bufferOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0x12, 0x34, 0x56, 0x78])))).toBe('Invalid JPEG: bad marker')
    })

    it('rejects segment lengths below 2', () => {
      expect(checkPreview(bufferOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x00, 0x00])))).toBe('Invalid JPEG: bad segment length')
    })

    it('rejects files that end before a frame header', () => {
      expect(checkPreview(bufferOf(new Uint8Array([0xff, 0xd8, ...JFIF_APP0])))).toBe('Invalid JPEG: file is truncated')
    })

    it('rejects truncated frame headers', () => {
      expect(checkPreview(bufferOf(jpeg(800, 450).slice(0, 2 + JFIF_APP0.length + 8)))).toBe('Invalid JPEG: truncated frame header')
    })
  })

  it.each([
    ['GIF', utf8('GIF89a\x01\x00\x01\x00')],
    ['WebP', utf8('RIFF\x00\x00\x00\x00WEBPVP8 ')],
    ['an empty file', new Uint8Array(0)],
    ['a bare PNG signature prefix', new Uint8Array(PNG_SIGNATURE.slice(0, 7))],
  ])('rejects %s', (_, bytes) => {
    expect(checkPreview(bufferOf(bytes))).toBe('The preview image must be a PNG or JPEG')
  })

  it('accepts the minimum and maximum dimensions', () => {
    const { minWidth, minHeight, maxWidth, maxHeight } = PREVIEW_RULES
    expect(checkPreview(bufferOf(png(minWidth, minHeight)))).toMatchObject({ width: 160, height: 90 })
    expect(checkPreview(bufferOf(jpeg(maxWidth, maxHeight)))).toMatchObject({ width: 1920, height: 1080 })
  })

  it.each([
    [159, 90],
    [160, 89],
    [0, 0],
  ])('rejects images smaller than the minimum (%ix%i)', (w, h) => {
    expect(checkPreview(bufferOf(png(w, h)))).toBe(`The preview image is too small (${w}x${h}, min 160x90)`)
  })

  it.each([
    [1921, 1080],
    [1920, 1081],
    [2 ** 32 - 1, 500],
  ])('rejects images larger than the maximum (%ix%i)', (w, h) => {
    expect(checkPreview(bufferOf(png(w, h)))).toBe(`The preview image is too large (${w}x${h}, max 1920x1080)`)
  })
})

describe('readPreview', () => {
  it('returns the image info, bytes, and hash', async () => {
    const bytes = png(320, 180)
    const result = await readPreview(file(bytes, 'shot.png'))
    expect(result).toMatchObject({ type: 'image/png', ext: 'png', width: 320, height: 180, sha256: await sha256Hex(bytes.buffer) })
    expect(new Uint8Array((result as { buf: ArrayBuffer }).buf)).toEqual(bytes)
  })

  it('sniffs the format from content, not the file name or MIME type', async () => {
    expect(await readPreview(file(jpeg(320, 180), 'shot.png', 'image/png'))).toMatchObject({ type: 'image/jpeg', ext: 'jpg' })
    expect(await readPreview(file(utf8('<svg/>'), 'shot.png', 'image/png'))).toBe('The preview image must be a PNG or JPEG')
  })

  it('rejects files over the size limit before parsing them', async () => {
    const bytes = png(320, 180, { padding: PREVIEW_RULES.maxBytes })
    expect(await readPreview(file(bytes, 'big.png'))).toBe('The preview image is too large (max 1024 KB). Try a JPEG or a lower resolution.')
  })

  it('accepts files exactly at the size limit', async () => {
    const overhead = png(320, 180).length
    const bytes = png(320, 180, { padding: PREVIEW_RULES.maxBytes - overhead })
    expect(bytes.length).toBe(PREVIEW_RULES.maxBytes)
    expect(await readPreview(file(bytes, 'big.png'))).toMatchObject({ width: 320 })
  })
})

describe('checkSca', () => {
  const check = (bytes: Uint8Array<ArrayBuffer>) => checkSca(bytes.buffer)

  it('accepts a well-formed file', () => {
    expect(check(sca())).toBeNull()
  })

  it('accepts chunks in any order', () => {
    expect(check(sca(scaChunks().reverse()))).toBeNull()
  })

  it('accepts a final chunk without trailing padding', () => {
    const chunks = replaceChunk('META', utf8('{"name":"a","author":"b"}'))
    expect(check(sca(chunks, { padLast: false }))).toBeNull()
  })

  it('accepts the maximum sample count', () => {
    expect(check(sca(scaChunks({ samples: 256 })))).toBeNull()
  })

  it('accepts an empty CSEQ chunk', () => {
    expect(check(sca(replaceChunk('CSEQ', new Uint8Array(0))))).toBeNull()
  })

  it('accepts META with a UTF-8 byte order mark and extra keys', () => {
    const meta = utf8('\uFEFF{"name":"Ünïcode ♪","author":"Ann","bpm":120}')
    expect(check(sca(replaceChunk('META', meta)))).toBeNull()
  })

  // The .sca spec says readers skip unknown tags so future versions can add optional chunks.
  it('skips unknown chunks', () => {
    const chunks = [...scaChunks(), { tag: 'XTRA', body: new Uint8Array([1, 2, 3]) }]
    expect(check(sca(chunks))).toBeNull()
  })

  it('rejects an unknown chunk that runs past the end of the file', () => {
    const chunks = [...scaChunks(), { tag: 'XTRA', body: new Uint8Array(4), size: 100 }]
    expect(check(sca(chunks))).toMatch(/^Invalid \.sca file/)
  })

  it.each([
    ['empty', new Uint8Array(0)],
    ['too short', utf8('SCA')],
    ['wrong magic', utf8('SCB\x01')],
    ['lowercase magic', utf8('sca\x01')],
  ])('rejects a missing header (%s)', (_, bytes) => {
    expect(check(bytes)).toBe('Not a valid .sca file (missing SCA header)')
  })

  it('rejects unsupported versions', () => {
    expect(check(sca(scaChunks(), { version: 2 }))).toBe('Unsupported .sca version 2')
    expect(check(sca(scaChunks(), { version: 0 }))).toBe('Unsupported .sca version 0')
  })

  it('rejects a truncated chunk header', () => {
    expect(check(sca().slice(0, 4 + 6))).toBe('Invalid .sca file: truncated chunk header')
  })

  it('rejects duplicate chunks', () => {
    const chunks = scaChunks()
    expect(check(sca([...chunks, chunks[1]]))).toBe('Invalid .sca file: duplicate CSEQ chunk')
  })

  it.each([
    ['BANK', 0x64000],
    ['CSEQ', 0xc000],
    ['SIZE', 512],
    ['META', 4096],
  ])('rejects a %s chunk over %i bytes', (tag, cap) => {
    const chunks = scaChunks().map((c) => (c.tag === tag ? { ...c, size: cap + 1 } : c))
    expect(check(sca(chunks))).toBe(`Invalid .sca file: ${tag} chunk is too large`)
  })

  it('rejects a chunk that runs past the end of the file', () => {
    const chunks = scaChunks().map((c) => (c.tag === 'META' ? { ...c, size: c.body.length + 4 } : c))
    expect(check(sca(chunks))).toBe('Invalid .sca file: META chunk runs past end of file')
  })

  it.each(['BANK', 'CSEQ', 'SIZE', 'META'])('rejects a file without a %s chunk', (tag) => {
    expect(check(sca(scaChunks().filter((c) => c.tag !== tag)))).toBe(`Invalid .sca file: missing ${tag} chunk`)
  })

  it('rejects a BANK chunk smaller than its 0x800-byte header', () => {
    const bank = new Uint8Array(0x7ff)
    bank[0] = 2
    expect(check(sca(replaceChunk('BANK', bank)))).toBe('Invalid .sca file: BANK chunk is too small')
  })

  it('rejects a SIZE chunk with an odd length', () => {
    expect(check(sca(replaceChunk('SIZE', new Uint8Array(5))))).toBe('Invalid .sca file: SIZE chunk has an odd length')
  })

  it.each([0, -1, 257])('rejects a sample count of %i', (samples) => {
    const bank = new Uint8Array(0x800)
    new DataView(bank.buffer).setInt16(0, samples, true)
    const chunks = replaceChunk('SIZE', new Uint8Array(512), replaceChunk('BANK', bank))
    expect(check(sca(chunks))).toBe('Invalid .sca file: bad sample count in BANK')
  })

  it('rejects SIZE entries that do not match the sample count', () => {
    expect(check(sca(replaceChunk('SIZE', new Uint8Array(6))))).toBe('Invalid .sca file: SIZE entries do not match BANK sample count')
  })

  it.each([
    ['invalid UTF-8', new Uint8Array([0x7b, 0xff, 0x7d])],
    ['invalid JSON', utf8('{name: "a"}')],
    ['empty', new Uint8Array(0)],
  ])('rejects META that is %s', (_, body) => {
    expect(check(sca(replaceChunk('META', body)))).toBe('Invalid .sca file: META is not valid UTF-8 JSON')
  })

  it.each([
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"name"'],
  ])('rejects META that is %s', (_, json) => {
    expect(check(sca(replaceChunk('META', utf8(json))))).toBe('Invalid .sca file: META must be a JSON object')
  })

  it.each([
    ['name missing', { author: 'Ann' }],
    ['author missing', { name: 'Song' }],
    ['name not a string', { name: 5, author: 'Ann' }],
    ['author not a string', { name: 'Song', author: null }],
  ])('rejects META with %s', (_, meta) => {
    expect(check(sca(scaChunks({ meta })))).toBe('Invalid .sca file: META needs string "name" and "author"')
  })
})