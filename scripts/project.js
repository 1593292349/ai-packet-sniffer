const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const repairScript = path.join(__dirname, 'repair-electron.js');
const cleanScript = path.join(__dirname, 'kill-dev-processes.js');

function packageFile(packageName, relativePath) {
  return path.join(path.dirname(require.resolve(`${packageName}/package.json`)), relativePath);
}

const viteCli = packageFile('vite', 'bin/vite.js');
const tscCli = packageFile('typescript', 'lib/tsc.js');
const vueTscCli = packageFile('vue-tsc', 'bin/vue-tsc.js');
const vitestCli = packageFile('vitest', 'vitest.mjs');
const builderCli = packageFile('electron-builder', 'cli.js');

function startProcess(command, args, options = {}) {
  return spawn(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: false,
    ...options,
  });
}

function childResult(child) {
  return new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, signal: null, error }));
    child.once('exit', (code, signal) => resolve({ code, signal, error: null }));
  });
}

async function runProcess(command, args, label, options = {}) {
  const result = await childResult(startProcess(command, args, options));
  if (result.error) throw new Error(`${label} 启动失败: ${result.error.message}`);
  if (result.code !== 0) {
    const reason = result.signal ? `信号 ${result.signal}` : `退出码 ${result.code}`;
    throw new Error(`${label} 执行失败: ${reason}`);
  }
}

function runNode(script, args, label, options) {
  return runProcess(process.execPath, [script, ...args], label, options);
}

function waitForPort(port, timeoutMs = 30_000, signal) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    let retryTimer = null;
    let socket = null;
    let settled = false;

    const cleanup = () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (socket) socket.destroy();
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(new Error('端口等待已取消'));

    const attempt = () => {
      if (settled) return;
      let finished = false;
      socket = net.createConnection({ host: 'localhost', port });

      const retry = () => {
        if (finished || settled) return;
        finished = true;
        socket.destroy();
        if (Date.now() >= deadline) {
          finish(new Error(`等待 localhost:${port} 超时`));
          return;
        }
        retryTimer = setTimeout(attempt, 100);
      };

      socket.setTimeout(500);
      socket.once('connect', () => {
        if (finished) return;
        finished = true;
        finish();
      });
      socket.once('error', retry);
      socket.once('timeout', retry);
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    attempt();
  });
}

function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  child.kill('SIGTERM');
}

async function repairElectron() {
  await runNode(repairScript, [], 'Electron 修复');
}

function cleanBuildOutputs() {
  for (const directory of ['dist', 'dist-electron', 'release']) {
    fs.rmSync(path.join(projectRoot, directory), { recursive: true, force: true });
  }
}

async function cleanDevProcesses() {
  await runNode(cleanScript, [], '开发进程清理');
}

async function compile() {
  await runNode(viteCli, ['build'], 'Vite 构建');
  await runNode(tscCli, ['-p', 'electron/tsconfig.json'], 'Electron 构建');
}

async function dev() {
  await repairElectron();
  await cleanDevProcesses();

  const vite = startProcess(process.execPath, [viteCli]);
  const viteExit = childResult(vite);
  let electron = null;
  let stopping = false;
  const portController = new AbortController();

  const stopChildren = () => {
    stopping = true;
    terminateProcessTree(electron);
    terminateProcessTree(vite);
  };
  const onSignal = () => stopChildren();

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const readiness = await Promise.race([
      waitForPort(5173, 30_000, portController.signal).then(() => ({ ready: true })),
      viteExit.then((result) => ({ ready: false, result })),
    ]);
    if (!readiness.ready) {
      portController.abort();
      if (stopping) return;
      const reason = readiness.result.error?.message || readiness.result.signal || readiness.result.code;
      throw new Error(`Vite 在端口就绪前退出: ${reason}`);
    }

    await runNode(tscCli, ['-p', 'electron/tsconfig.json'], 'Electron 构建');
    if (stopping) return;

    if (vite.exitCode !== null || vite.signalCode !== null) {
      const result = await viteExit;
      const reason = result.error?.message || result.signal || result.code;
      throw new Error(`Vite 在 Electron 启动前退出: ${reason}`);
    }

    electron = startProcess(require('electron'), [projectRoot], {
      env: { ...process.env, NODE_ENV: 'development' },
    });

    const outcome = await Promise.race([
      viteExit.then((result) => ({ name: 'Vite', result })),
      childResult(electron).then((result) => ({ name: 'Electron', result })),
    ]);

    if (!stopping) {
      const { result } = outcome;
      if (result.error) throw new Error(`${outcome.name} 运行失败: ${result.error.message}`);
      if (outcome.name === 'Vite' || result.code !== 0) {
        const reason = result.signal ? `信号 ${result.signal}` : `退出码 ${result.code}`;
        throw new Error(`${outcome.name} 意外退出: ${reason}`);
      }
    }
  } finally {
    portController.abort();
    stopChildren();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

async function build() {
  cleanBuildOutputs();
  await repairElectron();
  await compile();
  await runNode(builderCli, ['--win'], 'Windows 打包', {
    env: {
      ...process.env,
      ELECTRON_BUILDER_BINARIES_MIRROR:
        process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
        'https://registry.npmmirror.com/-/binary/electron-builder-binaries/',
    },
  });
}

async function test() {
  await runNode(vueTscCli, ['--noEmit'], 'Vue 类型检查');
  await runNode(tscCli, ['-p', 'electron/tsconfig.json', '--noEmit'], 'Electron 类型检查');
  await runNode(vitestCli, ['run'], 'Vitest');
}

async function main() {
  const command = process.argv[2];
  const commands = {
    dev,
    build,
    test,
  };
  const task = commands[command];
  if (!task) {
    throw new Error(`未知命令: ${command || '(空)'}。可用命令: ${Object.keys(commands).join(', ')}`);
  }
  await task();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { build, dev, test, waitForPort };
