const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Ensure public directory exists
const publicDir = path.join(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const full = Buffer.concat([typeBuf, data]);
  const crc = zlib.crc32(full);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPng(width, height, isMaskable = false) {
  const rowSize = width * 4 + 1;
  const rawData = Buffer.alloc(height * rowSize);

  // Background: Deep UBC Blue #002145 (R: 0, G: 33, B: 69)
  // Gold Accent: #E8AF10 (R: 232, G: 175, B: 16)
  // White: #FFFFFF (R: 255, G: 255, B: 255)

  const scale = width / 512;
  const safeMargin = isMaskable ? 0.8 : 1.0; // Maskable icon keeps contents within central 80%

  const cx = width / 2;
  const cy = height / 2;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;

      // Base background: #002145
      let r = 0;
      let g = 33;
      let b = 69;
      let a = 255;

      // Subtle gradient vertically
      const vRatio = y / height;
      r = Math.min(255, Math.floor(0 + vRatio * 7));
      g = Math.min(255, Math.floor(33 - vRatio * 8));
      b = Math.min(255, Math.floor(69 - vRatio * 15));

      // Check distance from center for rounded outer rect (if not maskable)
      if (!isMaskable) {
        const cornerRadius = 100 * scale;
        const rx = Math.abs(x - cx) - (width / 2 - cornerRadius);
        const ry = Math.abs(y - cy) - (height / 2 - cornerRadius);
        if (rx > 0 && ry > 0) {
          const dist = Math.sqrt(rx * rx + ry * ry);
          if (dist > cornerRadius) {
            a = 0;
          } else if (dist > cornerRadius - 1.5) {
            a = Math.floor(255 * (cornerRadius - dist) / 1.5);
          }
        }
      }

      if (a > 0) {
        // Draw Calendar card in center
        // Normalized coordinates relative to center
        const nx = (x - cx) / (scale * safeMargin);
        const ny = (y - cy) / (scale * safeMargin);

        // Calendar bounds: width 320, height 270 (x: -160 to 160, y: -90 to 180)
        const cardLeft = -160;
        const cardRight = 160;
        const cardTop = -100;
        const cardBottom = 160;
        const cardRadius = 24;

        // Inside card check
        if (nx >= cardLeft && nx <= cardRight && ny >= cardTop && ny <= cardBottom) {
          const inCorner = (
            (nx < cardLeft + cardRadius && ny < cardTop + cardRadius && Math.hypot(nx - (cardLeft + cardRadius), ny - (cardTop + cardRadius)) > cardRadius) ||
            (nx > cardRight - cardRadius && ny < cardTop + cardRadius && Math.hypot(nx - (cardRight - cardRadius), ny - (cardTop + cardRadius)) > cardRadius) ||
            (nx < cardLeft + cardRadius && ny > cardBottom - cardRadius && Math.hypot(nx - (cardLeft + cardRadius), ny - (cardBottom - cardRadius)) > cardRadius) ||
            (nx > cardRight - cardRadius && ny > cardBottom - cardRadius && Math.hypot(nx - (cardRight - cardRadius), ny - (cardBottom - cardRadius)) > cardRadius)
          );

          if (!inCorner) {
            // Header band of calendar: ny <= -30
            if (ny <= -35) {
              // Gold header
              r = 232;
              g = 175;
              b = 16;
            } else {
              // White calendar page body
              r = 250;
              g = 252;
              b = 255;

              // Checkmark drawing:
              // Line 1: from (-80, 50) to (-20, 105)
              // Line 2: from (-20, 105) to (95, -15)
              const thickness = 22;

              // Distance to segment 1
              const d1 = distToSegment(nx, ny, -70, 45, -15, 95);
              // Distance to segment 2
              const d2 = distToSegment(nx, ny, -15, 95, 85, -5);

              if (d1 <= thickness || d2 <= thickness) {
                // Navy stroke
                r = 0;
                g = 33;
                b = 69;
              }
            }
          }
        }

        // Calendar Rings
        const ring1 = Math.abs(nx - (-80)) < 12 && Math.abs(ny - (-120)) < 24;
        const ring2 = Math.abs(nx - 80) < 12 && Math.abs(ny - (-120)) < 24;
        if (ring1 || ring2) {
          r = 0;
          g = 33;
          b = 69;
        }
      }

      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

// Generate all target files
console.log('Generating PWA icons...');
const icon192 = createPng(192, 192, false);
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), icon192);

const icon512 = createPng(512, 512, false);
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), icon512);

const iconMaskable = createPng(512, 512, true);
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), iconMaskable);

const appleIcon = createPng(180, 180, false);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleIcon);

// Favicon (32x32)
const favicon = createPng(32, 32, false);
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), favicon);

console.log('All PWA icons generated successfully in public/');
