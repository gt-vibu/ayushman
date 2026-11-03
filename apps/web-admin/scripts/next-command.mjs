import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const [command, ...args] = process.argv.slice(2);
if (!command || !['build', 'start'].includes(command)) throw new Error('Use the build or start command.');
// Keep generated Next artifacts outside the OneDrive-synced workspace during
// local development. OneDrive can mark diagnostic JSON files as reparse points,
// which makes Next's file tracing fail with EINVAL on Windows.
const externalBuildDir = path.relative(process.cwd(), path.join(path.parse(process.cwd()).root, 'ayushman-web-admin-next-cache'));

const child = spawn(process.execPath, [nextBin, command, ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? (process.env.VERCEL ? '.next' : externalBuildDir),
    NODE_PATH: process.env.NODE_PATH ?? path.resolve(process.cwd(), 'node_modules'),
  },
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
