/**
 * build/teamlog-source.png → 다중 크기 PNG(알파 유지) → 루트 Teamlog.ico (패키징·rcedit 이 파일 참조)
 *
 * png-to-ico 는 BMP DIB + AND 마스크로 조립해, 투명·반투명이 탐색기/작업 표시줄에서 검게 보이는 경우가 많음.
 * Windows Vista+ 는 ICO 안에 PNG 를 그대로 넣는 형식을 지원하므로, Sharp PNG 버퍼만 ICONDIR 로 묶음.
 */
const path = require('path');
const fs = require('fs');

/** Windows에서 흔히 쓰는 ICO 해상도(정사각) */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @param {Buffer[]} pngBuffers — 각각 완전한 PNG 파일 바이너리
 * @returns {Buffer}
 */
function buildIcoWithEmbeddedPngs(pngBuffers) {
  const n = pngBuffers.length;
  const headerAndDirLen = 6 + 16 * n;
  const parts = [];
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(n, 4);
  parts.push(header);

  let offset = headerAndDirLen;
  for (const png of pngBuffers) {
    if (png.length < 29 || !png.subarray(0, 8).equals(PNG_SIG)) {
      throw new Error('Each image must be a PNG buffer');
    }
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    const dir = Buffer.alloc(16);
    dir.writeUInt8(w >= 256 ? 0 : w, 0);
    dir.writeUInt8(h >= 256 ? 0 : h, 1);
    dir.writeUInt8(0, 2);
    dir.writeUInt8(0, 3);
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(png.length, 8);
    dir.writeUInt32LE(offset, 12);
    parts.push(dir);
    offset += png.length;
  }
  for (const png of pngBuffers) {
    parts.push(png);
  }
  return Buffer.concat(parts);
}

/**
 * 알파 0 인데 RGB 만 남은 픽셀(부적절한 잔상)만 정리한다.
 * 반투명 픽셀의 알파를 255 로 강제하면 RGB 가 검정(안티앨리어스 흔적)인 채 불투명해져
 * 브라우저 미리보기·아이콘 테두리가 검은 링으로 보이므로 여기서는 스냅하지 않는다.
 */
async function clearRgbWhereFullyTransparent(sharpMod, pngBuffer) {
  const { data, info } = await sharpMod(pngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }
  return sharpMod(data, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
    .toBuffer();
}

async function main() {
  const sharp = require('sharp');
  const root = path.join(__dirname, '..');
  const sourcePath = path.join(root, 'build', 'teamlog-source.png');
  const icoPath = path.join(root, 'Teamlog.ico');

  if (!fs.existsSync(sourcePath)) {
    console.error('Missing:', sourcePath);
    process.exit(1);
  }

  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

  const pngBuffersRaw = await Promise.all(
    ICO_SIZES.map((size) =>
      sharp(sourcePath)
        .ensureAlpha()
        .resize(size, size, {
          fit: 'contain',
          background: transparent,
          kernel: sharp.kernel.lanczos3,
        })
        .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
        .toBuffer()
    )
  );

  const pngBuffers = await Promise.all(pngBuffersRaw.map((buf) => clearRgbWhereFullyTransparent(sharp, buf)));

  const buf = buildIcoWithEmbeddedPngs(pngBuffers);
  fs.writeFileSync(icoPath, buf);
  console.log('Wrote', icoPath, `(${ICO_SIZES.join(', ')} px, PNG-in-ICO)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
