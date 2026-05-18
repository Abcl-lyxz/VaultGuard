// Packages the contents of extension/ into dist/vaultguard-extension-<version>.zip.
// Reads version from extension/manifest.json. Pure Node (no native deps) — uses a
// minimal store-only ZIP writer.

import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const extDir = join(root, "extension");
const outDir = join(root, "dist");

async function walk(dir) {
  const ents = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = (crc >>> 8) ^ table[(crc ^ b) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosTime(d) {
  return ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
}
function dosDate(d) {
  return (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
}

async function buildZip(files) {
  const localChunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dt = dosTime(now), dd = dosDate(now);

  for (const { path, data } of files) {
    const compressed = deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const stored = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const nameBuf = Buffer.from(path, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dt, 10);
    local.writeUInt16LE(dd, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    localChunks.push(local, nameBuf, stored);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(dt, 12);
    cd.writeUInt16LE(dd, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + stored.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localChunks, centralBuf, end]);
}

(async () => {
  const manifestJson = JSON.parse(await readFile(join(extDir, "manifest.json"), "utf8"));
  const version = manifestJson.version || "0.0.0";

  const files = [];
  for (const abs of await walk(extDir)) {
    const rel = relative(extDir, abs).split("\\").join("/");
    const data = await readFile(abs);
    files.push({ path: rel, data });
  }
  const zip = await buildZip(files);
  await mkdir(outDir, { recursive: true });
  const out = join(outDir, `vaultguard-extension-${version}.zip`);
  await writeFile(out, zip);
  console.log(`Wrote ${out} (${zip.length} bytes, ${files.length} files)`);
})();
