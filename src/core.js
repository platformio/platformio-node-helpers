/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { IS_WINDOWS, runCommand } from './misc';

import fs from 'fs-plus';
import path from 'path';

export function getCoreDir() {
  let userHomeDir = process.env.HOME || '~';
  if (IS_WINDOWS) {
    if (process.env.USERPROFILE) {
      userHomeDir = process.env.USERPROFILE;
    } else if (process.env.HOMEPATH) {
      userHomeDir = path.join(process.env.HOMEDRIVE || '', process.env.HOMEPATH);
    }
  }
  const coreDir =
    process.env.PLATFORMIO_CORE_DIR ||
    process.env.PLATFORMIO_HOME_DIR /* backward compatibility */ ||
    path.join(userHomeDir, '.platformio');
  if (!IS_WINDOWS) {
    return coreDir;
  }
  const coreDirPathFormat = path.parse(coreDir);
  const rootDir = path.format({
    root: coreDirPathFormat.root,
    dir: coreDirPathFormat.root,
    base: '.platformio',
    name: '.platformio'
  });
  // if we already created it
  if (fs.isDirectorySync(rootDir)) {
    return rootDir;
  }
  // Make sure that all path characters have valid ASCII codes.
  for (const char of coreDir) {
    if (char.charCodeAt(0) > 127) {
      // If they don't, put the pio home directory into the root of the disk.
      return rootDir;
    }
  }
  return coreDir;
}

export function getEnvDir() {
  if ('PLATFORMIO_PENV_DIR' in process.env) {
    return process.env['PLATFORMIO_PENV_DIR'];
  }
  return path.join(getCoreDir(), 'penv');
}

export function getEnvBinDir() {
  return path.join(getEnvDir(), IS_WINDOWS ? 'Scripts' : 'bin');
}

export function getCacheDir() {
  const dir = path.join(getCoreDir(), '.cache');
  if (!fs.isDirectorySync(dir)) {
    fs.makeTreeSync(dir);
  }
  return dir;
}

export function getVersion() {
  return new Promise((resolve, reject) => {
    runCommand('platformio', ['--version'], (code, stdout, stderr) => {
      if (code === 0) {
        try {
          return resolve(stdout.trim().match(/[\d+\.]+.*$/)[0]);
        } catch (err) {
          return reject(err.toString());
        }
      }
      return reject(new Error(stderr));
    });
  });
}

export function runPIOCommand(args, callback, options = {}) {
  const baseArgs = ['-f'];
  if (process.env.PLATFORMIO_CALLER) {
    baseArgs.push('-c');
    baseArgs.push(process.env.PLATFORMIO_CALLER);
  }
  runCommand('platformio', [...baseArgs, ...args], callback, options);
}
