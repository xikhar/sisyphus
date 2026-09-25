import sharp from 'sharp';
import { stat } from 'node:fs/promises';

// Keep the ImageGen originals; ship smaller encodings to the browser.
for (const name of ['panorama', 'forest-ridge', 'limestone']) {
  const source = `art/source/${name}.png`;
  const destination = `public/assets/${name}.webp`;
  await sharp(source).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(destination);
  const a = await stat(source), b = await stat(destination);
  console.log(`${name}: ${Math.round(a.size / 1024)} KB → ${Math.round(b.size / 1024)} KB`);
}
