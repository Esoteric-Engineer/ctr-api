const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0))

const concat = (...parts: (ArrayLike<number>)[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const u32le = (n: number) => u32be(n).reverse()
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff]

const crc32 = (bytes: Uint8Array) => {
  let crc = ~0
  for (const byte of bytes) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

const pngChunk = (type: string, data: ArrayLike<number>) => {
  const body = concat(ascii(type), data)
  return concat(u32be(data.length), body, u32be(crc32(body)))
}

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export const png = (width: number, height: number, { padding = 0 } = {}) =>
  concat(
    PNG_SIGNATURE,
    pngChunk('IHDR', [...u32be(width), ...u32be(height), 8, 2, 0, 0, 0]),
    pngChunk('IDAT', new Uint8Array(padding)),
    pngChunk('IEND', []),
  )

const segment = (marker: number, body: number[]) => [0xff, marker, ...u16be(body.length + 2), ...body]

export const JFIF_APP0 = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
export const DHT = segment(0xc4, [0x00, ...new Array(16).fill(0)])

export const jpeg = (width: number, height: number, { sof = 0xc0, before = JFIF_APP0 }: { sof?: number; before?: number[] } = {}) =>
  concat(
    [0xff, 0xd8],
    before,
    segment(sof, [8, ...u16be(height), ...u16be(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    [0x12, 0x34, 0xff, 0xd9],
  )

export type ScaChunk = { tag: string; body: Uint8Array; size?: number }

export const scaChunks = ({ samples = 2, meta = { name: 'Crash Cove Theme', author: 'Ann' } }: { samples?: number; meta?: unknown } = {}): ScaChunk[] => {
  const bank = new Uint8Array(0x800 + 16 * samples)
  new DataView(bank.buffer).setInt16(0, samples, true)
  return [
    { tag: 'BANK', body: bank },
    { tag: 'CSEQ', body: new Uint8Array([1, 2, 3, 4, 5]) },
    { tag: 'SIZE', body: new Uint8Array(samples * 2).fill(1) },
    { tag: 'META', body: new TextEncoder().encode(JSON.stringify(meta)) },
  ]
}

export const sca = (chunks: ScaChunk[] = scaChunks(), { version = 1, padLast = true } = {}) =>
  concat(
    ascii('SCA'),
    [version],
    ...chunks.flatMap(({ tag, body, size = body.length }, i) => {
      const pad = padLast || i < chunks.length - 1 ? new Uint8Array(-body.length & 3) : []
      return [ascii(tag), u32le(size), body, pad]
    }),
  )

export const replaceChunk = (tag: string, body: Uint8Array, chunks = scaChunks()) =>
  chunks.map((c) => (c.tag === tag ? { tag, body } : c))

export const LEV = new Uint8Array([0x4c, 0x45, 0x56, 0x00, 0x01, 0x02, 0x03, 0x04])
export const VRM = new Uint8Array([0x56, 0x52, 0x4d, 0x00, 0x09, 0x08])

export const file = (bytes: Uint8Array<ArrayBuffer>, name: string, type = '') => new File([bytes], name, { type })

export const bytesOfSize = (size: number) => new Uint8Array(size).fill(7)

export const utf8 = (text: string) => new Uint8Array(new TextEncoder().encode(text))