const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..').replace(/\//g, '\\').toLowerCase();

function run(file, args) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function listeningProcesses(port) {
  const output = run('netstat.exe', ['-ano', '-p', 'TCP']);
  const processes = new Map();
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP') continue;
    const [localAddress, state, pidText] = [parts[1], parts[3], parts[4]];
    const portMatch = localAddress.match(/:(\d+)$/);
    if (state.toUpperCase() !== 'LISTENING' || Number(portMatch?.[1]) !== port) continue;
    const pid = Number(pidText);
    if (Number.isInteger(pid) && pid > 0) processes.set(pid, localAddress);
  }
  return processes;
}

function processInfo(pid) {
  const script = [
    `$process = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'`,
    'if ($null -ne $process) {',
    '  $parent = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $process.ParentProcessId)',
    '  [PSCustomObject]@{',
    '    Name = $process.Name',
    '    CommandLine = $process.CommandLine',
    '    ParentCommandLine = $parent.CommandLine',
    '  } | ConvertTo-Json -Compress',
    '}',
  ].join('\n');
  const output = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  return output ? JSON.parse(output) : null;
}

function isProjectProcess(info) {
  const commandLine = `${info?.CommandLine || ''}\n${info?.ParentCommandLine || ''}`
    .replace(/\//g, '\\')
    .toLowerCase();
  return commandLine.includes(projectRoot);
}

function killListener(port, allowedImages) {
  const listeners = listeningProcesses(port);
  for (const pid of listeners.keys()) {
    let info = null;
    try {
      info = processInfo(pid);
    } catch (error) {
      if (listeningProcesses(port).has(pid)) {
        throw new Error(`无法读取端口 ${port} 的占用进程 PID ${pid}: ${error.message}`);
      }
      continue;
    }
    if (!info) {
      if (listeningProcesses(port).has(pid)) {
        throw new Error(`无法确认端口 ${port} 的占用进程 PID ${pid}`);
      }
      continue;
    }
    const image = String(info.Name || '').toLowerCase();
    if (!allowedImages.includes(image) || !isProjectProcess(info)) {
      throw new Error(`端口 ${port} 被非本项目进程 ${info.Name || 'unknown'} (PID ${pid}) 占用，拒绝终止`);
    }
    try {
      run('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
    } catch {
      if (listeningProcesses(port).has(pid)) {
        throw new Error(`无法终止端口 ${port} 的 ${info.Name} (PID ${pid})`);
      }
    }
  }

  const remaining = listeningProcesses(port);
  if (remaining.size > 0) {
    throw new Error(`端口 ${port} 清理失败，仍由 PID ${[...remaining.keys()].join(', ')} 占用`);
  }
}

if (process.platform === 'win32') {
  killListener(5173, ['node.exe']);
  killListener(7890, ['electron.exe', 'ai packet sniffer.exe']);
}

console.log('[dev] stale Vite/Electron listeners cleaned and verified');
