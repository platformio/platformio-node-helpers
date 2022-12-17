/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as proc from './proc';

import fs from 'fs';
import path from 'path';

let _CORE_STATE = undefined;

export function setCoreState(state) {
  _CORE_STATE = state;
}

export function getCoreState() {
  return _CORE_STATE || {};
}

export function getCoreDir() {
  if (getCoreState().core_dir) {
    return getCoreState().core_dir;
  }
  // fallback
  let userHomeDir = process.env.HOME || '~';
  if (proc.IS_WINDOWS) {
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
  if (!proc.IS_WINDOWS) {
    return coreDir;
  }
  const coreDirPathFormat = path.parse(coreDir);
  const rootDir = path.format({
    root: coreDirPathFormat.root,
    dir: coreDirPathFormat.root,
    base: '.platformio',
    name: '.platformio',
  });
  // if we already created it
  try {
    fs.accessSync(rootDir);
    return rootDir;
  } catch (err) {}
  // Make sure that all path characters have valid ASCII codes.
  for (const char of coreDir) {
    if (char.charCodeAt(0) > 127) {
      // If they don't, put the pio home directory into the root of the disk.
      return rootDir;
    }
  }
  return coreDir;
}

export function getCacheDir() {
  if (getCoreState().cache_dir) {
    return getCoreState().cache_dir;
  }
  // fallback
  const dir = path.join(getCoreDir(), '.cache');
  try {
    fs.accessSync(dir);
  } catch (err) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getTmpDir() {
  const dir = path.join(getCacheDir(), 'tmp');
  try {
    fs.accessSync(dir);
  } catch (err) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getEnvDir() {
  if (getCoreState().penv_dir) {
    return getCoreState().penv_dir;
  }
  // fallback
  if ('PLATFORMIO_PENV_DIR' in process.env) {
    return process.env['PLATFORMIO_PENV_DIR'];
  }
  return path.join(getCoreDir(), 'penv');
}

export function getEnvBinDir() {
  if (getCoreState().penv_bin_dir) {
    return getCoreState().penv_bin_dir;
  }
  // fallback
  return path.join(getEnvDir(), proc.IS_WINDOWS ? 'Scripts' : 'bin');
}

export async function getCorePythonExe() {
  const result = getCoreState().python_exe;
  if (!result) {
    throw new Error('PlatformIO Core is not installed');
  }
  return result;
}

export async function getCorePythonCommandOutput(args, options) {
  return await proc.getCommandOutput(await getCorePythonExe(), args, options);
}

export async function getPIOCommandOutput(args, options = {}) {
  const baseArgs = ['-m', 'platformio'];
  if (process.env.PLATFORMIO_CALLER) {
    baseArgs.push('-c', process.env.PLATFORMIO_CALLER);
  }
  return await getCorePythonCommandOutput([...baseArgs, ...args], options);
}

export async function runPIOCommand(args, callback, options = {}) {
  const baseArgs = ['-m', 'platformio'];
  if (process.env.PLATFORMIO_CALLER) {
    baseArgs.push('-c', process.env.PLATFORMIO_CALLER);
  }
  proc.runCommand(await getCorePythonExe(), [...baseArgs, ...args], callback, options);
}
