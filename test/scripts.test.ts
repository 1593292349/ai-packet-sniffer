import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const { waitForPort } = require('../scripts/project.js');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronTsconfig = JSON.parse(
  fs.readFileSync(path.join(root, 'electron', 'tsconfig.json'), 'utf8'),
);
const projectSource = fs
  .readFileSync(path.join(root, 'scripts', 'project.js'), 'utf8')
  .replace(/\r\n/g, '\n');
const cleanupSource = fs.readFileSync(
  path.join(root, 'scripts', 'kill-dev-processes.js'),
  'utf8',
);
const viteConfigSource = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
const electronMainSource = fs.readFileSync(path.join(root, 'electron', 'main.ts'), 'utf8');

describe('npm scripts', () => {
  it('只暴露公共命令并把复杂编排委托给脚本文件', () => {
    expect(pkg.scripts).toEqual({
      dev: 'node scripts/project.js dev',
      build: 'node scripts/project.js build',
      test: 'node scripts/project.js test',
    });

    expect(fs.existsSync(path.join(root, 'scripts', 'project.js'))).toBe(true);

    for (const dependency of ['concurrently', 'cross-env', 'wait-on']) {
      expect(pkg.devDependencies[dependency], dependency).toBeUndefined();
    }
  });

  it('只清理当前项目的 Electron 开发进程或 portable 子进程', () => {
    expect(cleanupSource).toContain("killListener(7890, ['electron.exe', 'ai packet sniffer.exe']);");
    expect(cleanupSource).toContain('!isProjectProcess(info)');
  });

  it('把所有构建产物统一输出到 dist 目录', () => {
    expect(pkg.main).toBe('dist/electron/main.js');
    expect(pkg.build.directories.output).toBe('dist/release');
    expect(pkg.build.files).toEqual([
      'dist/renderer/**/*',
      'dist/electron/**/*',
      'package.json',
    ]);
    expect(electronTsconfig.compilerOptions.outDir).toBe('../dist/electron');
    expect(viteConfigSource).toContain("outDir: 'dist/renderer'");
    expect(electronMainSource).toContain("path.join(__dirname, '../renderer/index.html')");
    expect(projectSource).toContain("for (const directory of ['dist', 'dist-electron', 'release'])");
  });

  it('能等待 Vite 在 localhost 上监听', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, 'localhost', resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('无法获取测试端口');
      await expect(waitForPort(address.port, 500)).resolves.toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('Vite 提前退出时能取消端口等待', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(waitForPort(1, 100, controller.signal)).rejects.toThrow('端口等待已取消');
  });

  it('收到停止信号后不会再启动 Electron，并允许重复清理子进程', () => {
    expect(projectSource).toContain(
      "await runNode(tscCli, ['-p', 'electron/tsconfig.json'], 'Electron 构建');\n    if (stopping) return;",
    );
    expect(projectSource).not.toContain('if (stopping) return;\n    stopping = true;');
  });
});
