/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import fs from 'fs-plus';
import path from 'path';
import { runCommand } from './misc';


const IS_WINDOWS = process.platform.startsWith('win');

export function getHomeDir() {
  const result = process.env.PLATFORMIO_HOME_DIR || path.join(fs.getHomeDirectory() || '~', '.platformio');
  if (IS_WINDOWS) {
    // Make sure that all path characters have valid ASCII codes.
    for (const char of result) {
      if (char.charCodeAt(0) > 127) {
        // If they don't, put the pio home directory into the root of the disk.
        const homeDirPathFormat = path.parse(result);
        return path.format({
          root: homeDirPathFormat.root,
          dir: homeDirPathFormat.root,
          base: '.platformio',
          name: '.platformio'
        });
      }
    }
  }
  return result;
}

export function getEnvDir() {
  return path.join(getHomeDir(), 'penv');
}

export function getEnvBinDir() {
  return path.join(getEnvDir(), IS_WINDOWS ? 'Scripts' : 'bin');
}

export function getVersion() {
  return new Promise((resolve, reject) => {
    runCommand(
      'platformio',
      ['--version'],
      (code, stdout, stderr) => {
        if (code === 0) {
          try {
            return resolve(stdout.trim().match(/[\d+\.]+.*$/)[0]);
          } catch (err) {
            return reject(err.toString());
          }
        }
        return reject(stderr);
      }
    );
  });
}

export function runPIOCommand(args, callback, options = {}) {
  const baseArgs = ['-f'];
  if (process.env.PLATFORMIO_CALLER) {
    baseArgs.push('-c');
    baseArgs.push(process.env.PLATFORMIO_CALLER);
  }
  runCommand(
    'platformio',
    [...baseArgs, ...args],
    callback,
    options
  );
}
