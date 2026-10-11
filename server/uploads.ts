export function decodeUpload(value: unknown, maximumBytes: number): { bytes: Buffer; data: string; declaredMime?: string } | null {
  if (typeof value !== 'string' || value.length > Math.ceil(maximumBytes / 3) * 4 + 200) return null;
  const match = value.match(/^data:([^;,]+);base64,(.*)$/s);
  const data = match ? match[2] : value;
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > maximumBytes || bytes.toString('base64') !== data) return null;
  return { bytes, data, ...(match ? { declaredMime: match[1].toLowerCase() } : {}) };
}
export function validateImageUpload(value: unknown, rawMime: unknown, maximumBytes: number) {
  if (typeof rawMime !== 'string') return null;
  const normalize = (mime: string) => mime.toLowerCase().trim().replace('image/jpg', 'image/jpeg').replace('application/x-pdf', 'application/pdf');
  const mimeType = normalize(rawMime), upload = decodeUpload(value, maximumBytes);
  if (!upload || upload.declaredMime && normalize(upload.declaredMime) !== mimeType) return null;
  const b = upload.bytes;
  const valid = mimeType === 'image/png' ? b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && b.toString('ascii',12,16) === 'IHDR'
    : mimeType === 'image/jpeg' ? b.length >= 4 && b[0] === 255 && b[1] === 216 && b[2] === 255
    : mimeType === 'image/webp' ? b.length >= 12 && b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP'
    : mimeType === 'application/pdf' ? /^%PDF-[12]\.\d/.test(b.toString('ascii',0,8)) : false;
  return valid ? { mimeType, data: upload.data } : null;
}

// Self-contained so the production worker can embed this function without
// requiring TypeScript source files. Verify actual inflation, not just claimed sizes.
export function validateWorkbookZip(b: Buffer, inflate: (input: Buffer, options: { maxOutputLength: number }) => Buffer): boolean {
  try {
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    if (end < 0 || b.readUInt16LE(end+4) !== 0 || b.readUInt16LE(end+6) !== 0) return false;
    const count = b.readUInt16LE(end+10), size = b.readUInt32LE(end+12); let offset = b.readUInt32LE(end+16);
    if (!count || count > 1000 || offset + size > end) return false;
    let total = 0, workbook = false, types = false;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > end || b.readUInt32LE(offset) !== 0x02014b50) return false;
      const flags = b.readUInt16LE(offset+8), method = b.readUInt16LE(offset+10), compressed = b.readUInt32LE(offset+20), expanded = b.readUInt32LE(offset+24);
      const nameLength = b.readUInt16LE(offset+28), extraLength = b.readUInt16LE(offset+30), commentLength = b.readUInt16LE(offset+32), local = b.readUInt32LE(offset+42);
      const name = b.toString('utf8',offset+46,offset+46+nameLength);
      if (flags & 1 || ![0,8].includes(method) || expanded > 10*1024*1024 || (total += expanded) > 20*1024*1024 || /vbaProject\.bin$/i.test(name)) return false;
      if (local + 30 > b.length || b.readUInt32LE(local) !== 0x04034b50) return false;
      const start = local + 30 + b.readUInt16LE(local+26) + b.readUInt16LE(local+28);
      if (start + compressed > b.length) return false;
      const raw = b.subarray(start,start+compressed);
      const actual = method === 8 ? inflate(raw,{maxOutputLength:Math.max(1,expanded)}) : raw;
      if (actual.length !== expanded) return false;
      workbook ||= name === 'xl/workbook.xml' || name === 'xl/workbook.bin';
      types ||= name === '[Content_Types].xml';
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return workbook && types;
  } catch { return false; }
}
