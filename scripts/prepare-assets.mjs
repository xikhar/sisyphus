import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

// Lossless sprite extraction: the generated pixels and alpha are unchanged.
const atlas = 'art/source/sisyphus-atlas.png';
const { width, height } = await sharp(atlas).metadata();
const parts = ['head', 'torso', 'cloth', 'upper-arm', 'forearm', 'thigh', 'shin', 'foot', 'boulder'];
await mkdir('public/assets/sisyphus', { recursive: true });
const metadata = {};
for (let i = 0; i < parts.length; i++) {
  const left = Math.round((i % 3) * width / 3);
  // ImageGen placed the third row slightly above the nominal grid boundary.
  const rows = [0, Math.round(height / 3), Math.round(height * 814 / 1254), height];
  const top = rows[Math.floor(i / 3)];
  const right = Math.round(((i % 3) + 1) * width / 3);
  const bottom = rows[Math.floor(i / 3) + 1];
  const region = { left, top, width: right - left, height: bottom - top };
  const { data, info } = await sharp(atlas).extract(region).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 20) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  const crop = { left: left + Math.max(0, x0 - 2), top: top + Math.max(0, y0 - 2), width: Math.min(info.width - Math.max(0, x0 - 2), x1 - x0 + 5), height: Math.min(info.height - Math.max(0, y0 - 2), y1 - y0 + 5) };
  await sharp(atlas).extract(crop).png().toFile(`public/assets/sisyphus/${parts[i]}.png`);
  metadata[parts[i]] = crop;
}
await writeFile('art/sisyphus-crops.json', `${JSON.stringify(metadata, null, 2)}\n`);
console.log('Extracted nine individual transparent sprites.');
