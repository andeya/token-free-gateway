#!/usr/bin/env node
/**
 * Resolves the platform-specific optional dependency and runs the native binary.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * @returns {string | null}
 */
function platformPackageName() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin' && arch === 'arm64') return '@andeya/token-free-gateway-darwin-arm64';
  if (platform === 'darwin' && arch === 'x64') return '@andeya/token-free-gateway-darwin-x64';
  if (platform === 'linux' && arch === 'x64') return '@andeya/token-free-gateway-linux-x64';
  if (platform === 'linux' && arch === 'arm64') return '@andeya/token-free-gateway-linux-arm64';
  if (platform === 'win32' && arch === 'x64') return '@andeya/token-free-gateway-win32-x64';
  return null;
}

function main() {
  const pkgName = platformPackageName();
  if (pkgName === null) {
    console.error(
      `token-free-gateway: unsupported platform ${process.platform} ${process.arch}`,
    );
    process.exit(1);
  }

  let pkgRoot;
  try {
    pkgRoot = path.dirname(require.resolve(`${pkgName}/package.json`));
  } catch {
    console.error(
      `token-free-gateway: missing platform package ${pkgName}. ` +
        'Reinstall token-free-gateway so optional dependencies can be fetched.',
    );
    process.exit(1);
  }

  const binaryName =
    process.platform === 'win32' ? 'token-free-gateway.exe' : 'token-free-gateway';
  const binaryPath = path.join(pkgRoot, 'bin', binaryName);

  if (!fs.existsSync(binaryPath)) {
    console.error(`token-free-gateway: binary not found at ${binaryPath}`);
    process.exit(1);
  }

  const result = spawnSync(binaryPath, process.argv.slice(2), {
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status === null ? 1 : result.status);
}

main();
