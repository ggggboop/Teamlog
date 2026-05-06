/**
 * Electron 메인/프리로드를 .cjs로 빌드 (CommonJS)
 * package.json "type": "module" 환경에서 exports 충돌 방지
 */
import * as esbuild from 'esbuild';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'dist-electron', 'electron');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const packageVersion =
  typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0';

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

await esbuild.build({
  entryPoints: [
    join(root, 'electron', 'main.ts'),
    join(root, 'electron', 'preload.ts'),
  ],
  outdir: outDir,
  outExtension: { '.js': '.cjs' },
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  bundle: true,
  external: ['electron', 'better-sqlite3'],
  sourcemap: false,
  define: {
    __TEAMLOG_PACKAGE_VERSION__: JSON.stringify(packageVersion),
  },
});

// ElectronDatabaseAdapter는 main.ts에 번들됨 (같은 entryPoint)
// database 폴더는 별도 빌드 필요 - main이 import하므로 번들에 포함됨

console.log('Electron main/preload built to .cjs');
