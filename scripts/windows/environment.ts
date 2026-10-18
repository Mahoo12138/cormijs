import { type, machine } from 'node:os';

export function windowsEnvironment() {
  const result = { platform: process.platform, osType: type(), processArch: process.arch, machine: machine(), node: process.version };
  return { ...result, eligible: result.platform === 'win32' && result.osType === 'Windows_NT' && result.node === 'v22.14.0',
    reason: result.platform !== 'win32' || result.osType !== 'Windows_NT' ? 'WINDOWS_NATIVE_REQUIRED'
      : result.node !== 'v22.14.0' ? 'PINNED_NODE_REQUIRED' : null };
}
