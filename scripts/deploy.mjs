#!/usr/bin/env node
/**
 * Deploys the built application to the web server.
 *
 * Equivalent to:
 *   rm -rf /var/www/html/GnumarusProjectManager
 *   npm run build
 *   cp -r dist /var/www/html/GnumarusProjectManager
 */

import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const applicationName = 'GnumarusProjectManager';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = resolve(projectRoot, 'dist');
const targetDirectory = `/var/www/html/${applicationName}`;

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: 'inherit', cwd: projectRoot, ...options });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

async function main() {
  console.log(`> building the application`);
  await run('npm', ['run', 'build']);

  console.log(`> removing ${targetDirectory}`);
  await rm(targetDirectory, { recursive: true, force: true });

  await mkdir(dirname(targetDirectory), { recursive: true });

  console.log(`> copying dist to ${targetDirectory}`);
  await cp(distDirectory, targetDirectory, { recursive: true });

  console.log(`> deployed to ${targetDirectory}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
