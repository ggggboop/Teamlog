/**
 * 루트 Teamlog.ico 안의 PNG 프레임을 추출해 build/icon-preview/ 에 두고,
 * 체크무늬 배경 HTML로 투명도(알파)를 브라우저에서 바로 확인한다.
 *
 * 사용: npm run icon:preview
 * (먼저 npm run icon:generate 로 Teamlog.ico 생성)
 *
 * 탐색기 아이콘이 예전 그림이면 Windows 아이콘 캐시일 수 있음 — exe 파일명을 바꿔 보거나
 * build/icon-preview/index.html 로 ICO 자체는 정상인지 먼저 확인.
 */
const path = require('path');
const fs = require('fs');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function extractPngImagesFromIco(icoBuf) {
  if (icoBuf.length < 6) throw new Error('Invalid ICO: too small');
  const type = icoBuf.readUInt16LE(2);
  if (type !== 1) throw new Error('Invalid ICO: not icon type');
  const count = icoBuf.readUInt16LE(4);
  const images = [];
  let entryOff = 6;
  for (let i = 0; i < count; i++) {
    const w = icoBuf.readUInt8(entryOff);
    const h = icoBuf.readUInt8(entryOff + 1);
    const bytesInRes = icoBuf.readUInt32LE(entryOff + 8);
    const imageOffset = icoBuf.readUInt32LE(entryOff + 12);
    const pxW = w === 0 ? 256 : w;
    const pxH = h === 0 ? 256 : h;
    const png = icoBuf.subarray(imageOffset, imageOffset + bytesInRes);
    if (!png.subarray(0, 8).equals(PNG_SIG)) {
      throw new Error(`Entry ${i}: expected embedded PNG, got other format`);
    }
    images.push({ width: pxW, height: pxH, png });
    entryOff += 16;
  }
  return images;
}

async function main() {
  const root = path.join(__dirname, '..');
  const icoPath = path.join(root, 'Teamlog.ico');
  const outDir = path.join(root, 'build', 'icon-preview');

  if (!fs.existsSync(icoPath)) {
    console.error('Missing', icoPath, '\nRun: npm run icon:generate');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const icoBuf = fs.readFileSync(icoPath);
  const images = extractPngImagesFromIco(icoBuf);

  const rows = [];
  for (const { width, height, png } of images) {
    const name = `frame-${width}x${height}.png`;
    fs.writeFileSync(path.join(outDir, name), png);
    rows.push(
      `<section class="card"><h2>${width}×${height}</h2><div class="tile"><img src="${name}" width="${width}" height="${height}" alt="" /></div></section>`
    );
  }

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>Teamlog.ico 미리보기</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; background: #f4f4f5; color: #18181b; }
    h1 { font-size: 1.25rem; }
    .hint { max-width: 56rem; font-size: 0.875rem; color: #52525b; margin-bottom: 1.5rem; line-height: 1.5; }
    .grid { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-start; }
    .card { background: #fff; border-radius: 12px; padding: 12px 16px; box-shadow: 0 1px 3px rgb(0 0 0 / 0.08); }
    .card h2 { margin: 0 0 8px; font-size: 0.9rem; color: #3f3f46; }
    .tile {
      width: max-content;
      background-color: #fff;
      background-image:
        linear-gradient(45deg, #ccc 25%, transparent 25%),
        linear-gradient(-45deg, #ccc 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #ccc 75%),
        linear-gradient(-45deg, transparent 75%, #ccc 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
      border-radius: 8px;
      padding: 12px;
    }
    code { font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>Teamlog.ico — 추출된 PNG 프레임</h1>
  <p class="hint">
    아래 <strong>체크무늬</strong>가 아이콘 뒤로 비치면 알파(투명)가 정상입니다.
    <code>Teamlog.ico</code> (프로젝트 루트) 기준입니다. EXE 아이콘만 다르면 탐색기 캐시일 수 있으니
    설치본 실행 파일 이름을 바꿔 보거나 다른 폴더에 복사해 확인해 보세요.
  </p>
  <div class="grid">
    ${rows.join('\n')}
  </div>
</body>
</html>
`;

  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf-8');
  console.log('Wrote', outDir);
  console.log('Open:', path.join(outDir, 'index.html'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
