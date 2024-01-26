/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { bootstrap } from 'global-agent';
import fs from 'fs';
import path from 'path';
const { spawn } = require('child_process');

export const IS_WINDOWS = process.platform.startsWith('win');

/**
 * Returns system type in a format compatible with PIO Core get_systypy()
 */
export function getSysType() {
  const js2python = {
    win32_x64: 'windows_amd64',
    win32_x32: 'windows_x86',
    win32_ia32: 'windows_x86',
    darwin_x64: 'darwin_x86_64',
    darwin_x32: 'darwin_i686',
    darwin_arm64: 'darwin_arm64',
    linux_x64: 'linux_x86_64',
    linux_x32: 'linux_i686',
    linux_arm: 'linux_armv6l',
    linux_arm64: 'linux_aarch64',
    freebsd_x64: 'freebsd_amd64',
  };
  const result = `${process.platform}_${process.arch}`;
  return js2python[result] || result;
}

export function patchOSEnviron({ caller, extraPath, extraVars }) {
  process.env.PLATFORMIO_CALLER = caller;
  // Fix for platformio-atom-ide/issues/112
  if (process.platform === 'darwin') {
    process.env.LC_ALL = 'en_US.UTF-8';
  }
  if (caller === 'atom') {
    process.env.PLATFORMIO_DISABLE_PROGRESSBAR = 'true';
  }

  if (extraVars) {
    Object.keys(extraVars).forEach((name) => (process.env[name] = extraVars[name]));
  }

  // copy system PATH
  process.env.PLATFORMIO_PATH = process.env.PATH;

  // Fix for https://github.com/atom/atom/issues/11302
  if (process.env.Path) {
    if (process.env.PLATFORMIO_PATH) {
      process.env.PLATFORMIO_PATH += path.delimiter + process.env.Path;
    } else {
      process.env.PLATFORMIO_PATH = process.env.Path;
    }
  }

  if (extraPath) {
    extendOSEnvironPath('PLATFORMIO_PATH', extraPath.split(path.delimiter));
  }

  // Expand Windows environment variables in %xxx% format
  const reWindowsEnvVar = /\%([^\%]+)\%/g;
  const expandedEnvVars = [];
  while (IS_WINDOWS) {
    const matchedEnvVar = reWindowsEnvVar.exec(process.env.PLATFORMIO_PATH);
    if (!matchedEnvVar || expandedEnvVars.includes(matchedEnvVar[1])) {
      break;
    }
    expandedEnvVars.push(matchedEnvVar[1]);
    process.env.PLATFORMIO_PATH = process.env.PLATFORMIO_PATH.replace(
      matchedEnvVar[0],
      process.env[matchedEnvVar[1]] || '',
    );
  }

  // Configure NO_PROXY for PIO Home
  process.env.NO_PROXY =
    '127.0.0.1' + (process.env.NO_PROXY ? `,${process.env.NO_PROXY}` : '');
  if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY) {
    process.env.GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE = '';
    bootstrap();
  }
}

export function extendOSEnvironPath(name, items, prepend = true) {
  items.reverse().forEach((item) => {
    if (!process.env[name].includes(item)) {
      process.env[name] = (
        prepend ? [item, process.env[name]] : [process.env[name], item]
      ).join(path.delimiter);
    }
  });
}

/**
 * Run command helpers
 */

const __RUN_CMD_QUEUE = [];

export function terminateCmdsInQueue() {
  while (__RUN_CMD_QUEUE.length) {
    const callback = __RUN_CMD_QUEUE.pop()[2];
    if (callback) {
      callback(-1, undefined, new Error('Terminated by user'));
    }
  }
}

function _removeComletedCmdfromQueue(id) {
  const index = __RUN_CMD_QUEUE.findIndex((item) => item[3]._id === id);
  if (index > -1) {
    __RUN_CMD_QUEUE.splice(index, 1);
  }
}

function _runNextCmdFromQueue() {
  if (__RUN_CMD_QUEUE.length > 0) {
    _runCommand(...__RUN_CMD_QUEUE.pop());
  }
}

export function runCommand(cmd, args, callback = undefined, options = {}) {
  options = options || {};
  if (!options._id) {
    options._id = `${cmd}-${Math.random()}`;
  }
  if (options.runInQueue) {
    console.info('Put command in queue', cmd, args, options);
    __RUN_CMD_QUEUE.push([cmd, args, callback, options]);
    if (__RUN_CMD_QUEUE.length > 1) {
      return;
    }
  }
  return _runCommand(cmd, args, callback, options);
}

function _runCommand(cmd, args, callback, options) {
  console.info('runCommand', cmd, args, options);
  const outputLines = [];
  const errorLines = [];
  let completed = false;

  function onExit(code) {
    if (completed) {
      return;
    }
    if (options.runInQueue) {
      _removeComletedCmdfromQueue(options._id);
      _runNextCmdFromQueue();
    }
    if (!callback) {
      return;
    }
    completed = true;
    const stdout = outputLines.join('');
    const stderr = errorLines.join('');
    callback(code, stdout, stderr);
  }

  options.spawnOptions = options.spawnOptions || {};

  if (options.projectDir) {
    options.spawnOptions.cwd = options.projectDir;
  }

  // path PlatformIO's PATH
  const envClone = Object.assign({}, options.spawnOptions.env || process.env);
  if (process.env.PLATFORMIO_PATH) {
    envClone.PATH = process.env.PLATFORMIO_PATH;
    envClone.Path = process.env.PLATFORMIO_PATH;
  }
  options.spawnOptions.env = envClone;

  try {
    const subprocess = spawn(cmd, args, options.spawnOptions);
    if (options.onProcCreated) {
      options.onProcCreated(subprocess);
    }
    subprocess.stdout.on('data', (data) => {
      outputLines.push(data.toString());
      if (options.onProcStdout) {
        options.onProcStdout(data);
      }
    });
    subprocess.stderr.on('data', (data) => {
      errorLines.push(data.toString());
      if (options.onProcStderr) {
        options.onProcStderr(data);
      }
    });
    subprocess.on('close', onExit);
    subprocess.on('error', (err) => {
      errorLines.push(err.toString());
      onExit(-1);
    });
  } catch (err) {
    errorLines.push(err.toString());
    onExit(-1);
  }
}

/**
 * End run command helpers
 */

export function getCommandOutput(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    runCommand(
      cmd,
      args,
      (code, stdout, stderr) => {
        if (code === 0) {
          return resolve(stdout);
        } else {
          const errMessage = stdout ? `${stderr} -> ${stdout}` : stderr;
          const err = new Error(errMessage);
          err.stderr = stderr;
          err.stdout = stdout;
          return reject(err);
        }
      },
      options,
    );
  });
}

export function whereIsProgram(program) {
  const envPath = process.env.PLATFORMIO_PATH || process.env.PATH;
  for (const location of envPath.split(path.delimiter)) {
    const executable = path.normalize(path.join(location, program)).replace(/"/g, '');
    try {
      if (fs.existsSync(executable)) {
        return executable;
      }
    } catch (err) {}
  }
  return null;
}
