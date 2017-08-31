/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import fs from 'fs-plus';
import { getEnvBinDir } from './core';
import path from 'path';
import request from 'request';
import spawn from 'cross-spawn';


export function patchOSEnviron({ caller, useBuiltinPIOCore=true, extraPath, extraVars }) {
  // Fix for platformio-atom-ide/issues/112
  process.env.PLATFORMIO_CALLER = caller;
  process.env.LC_ALL = 'en_US.UTF-8';
  if (caller === 'atom') {
    process.env.PLATFORMIO_DISABLE_PROGRESSBAR = 'true';
  }

  if (extraVars) {
    Object.keys(extraVars).forEach(name => process.env[name] = extraVars[name]);
  }

  // Fix for https://github.com/atom/atom/issues/11302
  if (process.env.Path) {
    if (process.env.PATH) {
      process.env.PATH += path.delimiter + process.env.Path;
    } else {
      process.env.PATH = process.env.Path;
    }
  }

  const binDir = getEnvBinDir();
  if (useBuiltinPIOCore) { // Insert bin directory into PATH
    process.env.PATH = binDir + path.delimiter + process.env.PATH;
  } else { // Remove bin directory from PATH
    process.env.PATH = process.env.PATH.replace(binDir + path.delimiter, '');
    process.env.PATH = process.env.PATH.replace(path.delimiter + binDir, '');
  }

  if (extraPath && !process.env.PATH.includes(extraPath)) {
    process.env.PATH = extraPath + path.delimiter + process.env.PATH;
  }

  // copy PATH to Path (Windows issue)
  if (process.env.Path) {
    process.env.Path = process.env.PATH;
  }
  console.warn(process.env);
}

export function runCommand(cmd, args, callback=undefined, options = {}) {
  console.info('runCommand', cmd, args, options);
  let completed = false;
  const outputLines = [];
  const errorLines = [];

  try {
    const child = spawn(cmd, args, options.spawnOptions);

    child.stdout.on('data', (line) => outputLines.push(line));
    child.stderr.on('data', (line) => errorLines.push(line));
    child.on('close', onExit);
    child.on('error', (err) => {
      errorLines.push(err.toString());
      onExit(-1);
    }
    );
  } catch (err) {
    errorLines.push(err.toString());
    onExit(-1);
  }

  function onExit(code) {
    if (completed || !callback) {
      return;
    }
    completed = true;
    const stdout = outputLines.map(x => x.toString()).join('');
    const stderr = errorLines.map(x => x.toString()).join('');
    callback(code, stdout, stderr);
  }
}

export function processHTTPRequest(url, callback, options) {
  options = options || {};
  options.url = url;
  if (!options.hasOwnProperty('headers')) {
    options.headers = {
      'User-Agent': 'PlatformIO'
    };
  }
  console.info('processHTTPRequest', options);
  return request(options, (err, response, body) => {
    return callback(err, response, body);
  });
}

export async function getPythonExecutable(useBuiltinPIOCore=true, customDirs = null) {
  const IS_WINDOWS = process.platform.startsWith('win');
  const candidates = new Set();
  const defaultName = IS_WINDOWS ? 'python.exe' : 'python';

  if (customDirs) {
    customDirs.forEach(dir => candidates.add(path.join(dir, defaultName)));
  }

  if (useBuiltinPIOCore) {
    candidates.add(path.join(getEnvBinDir(), defaultName));
  }

  if (IS_WINDOWS) {
    candidates.add(defaultName);
    candidates.add('C:\\Python27\\' + defaultName);
  } else {
    candidates.add('python2.7');
    candidates.add(defaultName);
  }

  for (const item of process.env.PATH.split(path.delimiter)) {
    if (fs.isFileSync(path.join(item, defaultName))) {
      candidates.add(path.join(item, defaultName));
    }
  }

  for (const executable of candidates.values()) {
    if (await isPython2(executable)) {
      return executable;
    }
  }

  return null;
}

function isPython2(executable) {
  const args = ['-c', 'import sys; assert "msys" not in sys.executable.lower(); print ".".join(str(v) for v in sys.version_info[:2])'];
  return new Promise(resolve => {
    runCommand(
      executable,
      args,
      (code, stdout) => {
        resolve(code === 0 && stdout.startsWith('2.7'));
      }
    );
  });
}
