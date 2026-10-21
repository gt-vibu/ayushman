import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const [command, ...args] = process.argv.slice(2);
if (!command || !['build', 'start'].includes(command)) throw new Error('Use the build or start command.');
const externalBuildDir = path.relative(process.cwd(), path.join(path.parse(process.cwd()).root, 'ayushman-next-cache'));

const child = spawn(process.execPath, [nextBin, command, ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? externalBuildDir,
    NODE_PATH: process.env.NODE_PATH ?? path.resolve(process.cwd(), 'node_modules'),
  },
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
