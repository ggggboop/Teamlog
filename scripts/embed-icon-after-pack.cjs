/**
 * afterPack: win-unpacked exe 에 Teamlog.ico 아이콘 임베딩
 * (signAndEditExecutable: false 이면 electron-builder 가 exe 아이콘을 넣지 않는 경우가 있어 rcedit 사용)
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
  const iconPath = path.join(__dirname, '../build/Teamlog.ico');

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
    console.error('✗ rcedit failed:', err.message);
    throw err;
  }
};
