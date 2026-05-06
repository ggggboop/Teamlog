/**
 * signAndEditExecutable: false 일 때 exe 에 아이콘만 박는 afterPack 훅.
 * builder-util 의 app-builder rcedit 는 WinCodeSign 번들 해제(심볼릭 링크)에 실패하는 환경이 있어
 * npm rcedit 만 사용한다. 아이콘 파일은 프로젝트 루트 Teamlog.ico (PQR 의 PAB.ico 와 동일 역할).
 */
const path = require('path');
const fs = require('fs');

module.exports = async function (context) {
  if (context.electronPlatformName !== 'win32') return;

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
  const productName = pkg.build?.productName || 'Teamlog';
  const version = pkg.version;
  const exeName = `${productName} v${version}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(__dirname, '../Teamlog.ico');

  if (!fs.existsSync(exePath)) {
    console.warn('⚠ Exe not found:', exePath);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn('⚠ Icon not found:', iconPath);
    return;
  }

  try {
    const { rcedit } = await import('rcedit');
    await rcedit(exePath, { icon: iconPath });
    console.log('✓ Icon embedded:', exeName);
  } catch (err) {
    console.error('✗ rcedit failed:', err instanceof Error ? err.message : String(err));
    throw err;
  }
};
