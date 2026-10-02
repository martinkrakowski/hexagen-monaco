/**
 * Reads a store-method zip written by `writeZipStore` (the evidence pack's
 * output). It reads only what that writer produces: stored entries, sizes in
 * the central directory. Anything else throws.
 */
export function readZipStore(buf: Buffer): Map<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip entry");
    if (buf.readUInt16LE(p + 10) !== 0) throw new Error("compressed entry");
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const dataStart =
      localOff +
      30 +
      buf.readUInt16LE(localOff + 26) +
      buf.readUInt16LE(localOff + 28);
    out.set(name, Buffer.from(buf.subarray(dataStart, dataStart + size)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
