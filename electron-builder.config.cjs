/**
 * electron-builder 설정 — 빌드마다 electron-dist-build/<timestamp> 에 출력 (PQR Attachment Builder와 동일 패턴)
 * signAndEditExecutable: false — 일부 PC 에서 코드서명 도구 번들 해제가 실패할 수 있어 비활성.
 * afterPack: `embed-icon-after-pack.cjs` 가 npm rcedit 로 루트 Teamlog.ico 를 exe 에 적용.
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
    icon: path.join(__dirname, 'Teamlog.ico'),
    signAndEditExecutable: false,
  },
  afterPack: path.join(__dirname, 'scripts', 'embed-icon-after-pack.cjs'),
};
