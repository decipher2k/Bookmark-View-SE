/*
 * Copyright 2026 Dennis Michael Heine
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const outputDir = path.resolve(__dirname, '..', 'assets', 'icons');
const pngPath = path.join(outputDir, 'app.png');
const icoPath = path.join(outputDir, 'app.ico');
const icnsPath = path.join(outputDir, 'app.icns');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];

    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function buildPng(size) {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  const width = size;
  const height = size;
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + (x * bytesPerPixel);
      const centerX = x - width / 2;
      const centerY = y - height / 2;
      const distance = Math.sqrt((centerX * centerX) + (centerY * centerY));
      const radius = width * 0.42;
      const inCircle = distance < radius;
      const band = (Math.sin((x / width) * Math.PI * 6) + 1) / 2;

      const red = inCircle ? Math.round(20 + (190 * (1 - (distance / radius)))) : Math.round(8 + (40 * band));
      const green = inCircle ? Math.round(110 + (110 * band)) : Math.round(28 + (42 * band));
      const blue = inCircle ? Math.round(150 + (80 * (distance / radius))) : Math.round(38 + (80 * (y / height)));
      const alpha = 255;

      raw[pixelOffset] = red;
      raw[pixelOffset + 1] = green;
      raw[pixelOffset + 2] = blue;
      raw[pixelOffset + 3] = alpha;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function buildIco(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = 0;
  entry[1] = 0;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);

  return Buffer.concat([header, entry, pngBuffer]);
}

function buildIcns(pngBuffer) {
  const iconType = Buffer.from('ic09', 'ascii');
  const iconLength = Buffer.alloc(4);
  iconLength.writeUInt32BE(pngBuffer.length + 8, 0);
  const iconBlock = Buffer.concat([iconType, iconLength, pngBuffer]);

  const header = Buffer.from('icns', 'ascii');
  const totalLength = Buffer.alloc(4);
  totalLength.writeUInt32BE(iconBlock.length + 8, 0);

  return Buffer.concat([header, totalLength, iconBlock]);
}

ensureDir(outputDir);

const png = buildPng(512);
fs.writeFileSync(pngPath, png);
fs.writeFileSync(icoPath, buildIco(png));
fs.writeFileSync(icnsPath, buildIcns(png));

console.log(`Icons generated in ${outputDir}`);