const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { downloadArtifact } = require('@electron/get');

async function main() {
  const electronDir = path.resolve(__dirname, '..', 'node_modules', 'electron');
  const pkgPath = path.join(electronDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error('node_modules/electron 不存在，请先运行 npm install');
  }

  const version = require(pkgPath).version;
  const platformPath = process.platform === 'win32' ? 'electron.exe' : 'electron';
  const exePath = path.join(electronDir, 'dist', platformPath);
  const pathTxt = path.join(electronDir, 'path.txt');

  if (fs.existsSync(exePath) && fs.existsSync(pathTxt)) {
    console.log(`[electron] OK: ${exePath}`);
    return;
  }

  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch,
    force: false,
    mirrorOptions: {
      mirror: process.env.ELECTRON_MIRROR || 'https://registry.npmmirror.com/-/binary/electron/',
    },
  });

  const distPath = path.join(electronDir, 'dist');
  fs.rmSync(distPath, { recursive: true, force: true });
  fs.mkdirSync(distPath, { recursive: true });

  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(distPath)} -Force`,
    ], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-q', zipPath, '-d', distPath], { stdio: 'inherit' });
  }

  fs.writeFileSync(pathTxt, platformPath);

  if (!fs.existsSync(exePath)) {
    throw new Error(`Electron 解压后仍未找到 ${exePath}`);
  }

  console.log(`[electron] repaired: ${exePath}`);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
