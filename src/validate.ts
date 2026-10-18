export type FileKind = 'lev' | 'vrm' | 'sca'

export const FILE_RULES: Record<FileKind, { maxBytes: number; required: boolean }> = {
  lev: { maxBytes: 2 * 1024 * 1024, required: true },
  vrm: { maxBytes: 1.25 * 1024 * 1024, required: false },
  sca: { maxBytes: 512 * 1024, required: false },
}

export const checkFile = (kind: FileKind, file: File): string | null => {
  if (!file.name.toLowerCase().endsWith(`.${kind}`)) return `The ${kind} file must have a .${kind} extension`;
  if (file.size === 0) return `The .${kind} file is empty`;
  if (file.size > FILE_RULES[kind].maxBytes) return `The .${kind} file is too large (max ${FILE_RULES[kind].maxBytes / 1024} KB)`;
  return null;
}

export const sha256Hex = async (buf: ArrayBuffer): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)), (b) => b.toString(16).padStart(2, '0')).join('');

const SCA_CHUNK_CAPS: Record<string, number> = { BANK: 0x64000, CSEQ: 0xc000, SIZE: 512, META: 4096 }

export const checkSca = (buf: ArrayBuffer): string | null => {
  const view = new DataView(buf);
  const ascii = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(buf, offset, length));

  if (buf.byteLength < 4 || ascii(0, 3) !== 'SCA') return 'Not a valid .sca file (missing SCA header)';
  if (view.getUint8(3) !== 1) return `Unsupported .sca version ${view.getUint8(3)}`;

  const chunks = new Map<string, { offset: number; size: number }>();
  let offset = 4;
  while (offset < buf.byteLength) {
    if (offset + 8 > buf.byteLength) return 'Invalid .sca file: truncated chunk header';
    const tag = ascii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (!Object.hasOwn(SCA_CHUNK_CAPS, tag)) return 'Invalid .sca file: unknown chunk';
    if (chunks.has(tag)) return `Invalid .sca file: duplicate ${tag} chunk`;
    if (size > SCA_CHUNK_CAPS[tag]) return `Invalid .sca file: ${tag} chunk is too large`;
    if (offset + 8 + size > buf.byteLength) return `Invalid .sca file: ${tag} chunk runs past end of file`;
    chunks.set(tag, { offset: offset + 8, size });
    offset += 8 + size + (-size & 3);
  }

  for (const tag of Object.keys(SCA_CHUNK_CAPS)) {
    if (!chunks.has(tag)) return `Invalid .sca file: missing ${tag} chunk`;
  }

  const bank = chunks.get('BANK')!;
  const sizes = chunks.get('SIZE')!;
  const meta = chunks.get('META')!;

  if (bank.size < 0x800) return 'Invalid .sca file: BANK chunk is too small';
  if (sizes.size % 2 !== 0) return 'Invalid .sca file: SIZE chunk has an odd length';
  const numSamples = view.getInt16(bank.offset, true);
  if (numSamples < 1 || numSamples > 256) return 'Invalid .sca file: bad sample count in BANK';
  if (numSamples !== sizes.size / 2) return 'Invalid .sca file: SIZE entries do not match BANK sample count';

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(new Uint8Array(buf, meta.offset, meta.size)));
  } catch {
    return 'Invalid .sca file: META is not valid UTF-8 JSON';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'Invalid .sca file: META must be a JSON object';
  const { name, author } = parsed as Record<string, unknown>;
  if (typeof name !== 'string' || typeof author !== 'string') return 'Invalid .sca file: META needs string "name" and "author"';

  return null;
}
