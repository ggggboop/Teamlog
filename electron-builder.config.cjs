/**
 * electron-builder 설정 — 빌드마다 electron-dist-build/<timestamp> 에 출력 (PQR Attachment Builder와 동일 패턴)
 * afterPack 에서 rcedit 으로 exe 아이콘 임베딩 (signAndEditExecutable: false 대응)
 */
const pkg = require('./package.json');
const path = require('path');
const base = pkg.build || {};

const distOut =
  process.env.TEAMLOG_ELECTRON_OUT ||
  path.join(__dirname, 'electron-dist-build', String(Date.now()));

module.exports = {
  ...base,
  directories: {
    ...(base.directories || {}),
    output: distOut,
  },
  win: {
    ...base.win,
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
    /** NSIS/바로가기용 표시명과 맞춤 */
    executableName: `${pkg.build.productName} v${pkg.version}`,
    icon: path.join(__dirname, 'build', 'Teamlog.ico'),
    signAndEditExecutable: false,
  },
  afterPack: path.join(__dirname, 'scripts', 'embed-icon-after-pack.cjs'),
};
