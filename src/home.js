/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { getCoreDir, runPIOCommand } from './core';
import { reportError, sleep } from './misc';

import { PEPverToSemver } from './installer/helpers';
import fs from 'fs-plus';
import jsonrpc from 'jsonrpc-lite';
import path from 'path';
import qs from 'querystringify';
import request from 'request';
import semver from 'semver';
import tcpPortUsed from 'tcp-port-used';
import ws from 'ws';

const SERVER_LAUNCH_TIMEOUT = 5 * 60; // 5 minutes
const HTTP_HOST = '127.0.0.1';
const HTTP_PORT_BEGIN = 8010;
const HTTP_PORT_END = 8100;
const SESSION_ID = Math.round(Math.random() * 1000000);
let HTTP_PORT = 0;
let IDECMDS_LISTENER_STATUS = 0;

export function getFrontendUri(serverHost, serverPort, options) {
  const stateStorage = (loadState() || {}).storage || {};
  const params = {
    start: options.start || '/',
    theme: stateStorage.theme || options.theme,
    workspace: stateStorage.workspace || options.workspace,
    sid: SESSION_ID
  };
  Object.keys(params).forEach(key => {
    if ([undefined, null].includes(params[key])) {
      delete params[key];
    }
  });
  return `http://${serverHost}:${serverPort}?${qs.stringify(params)}`;
}

export async function getFrontendVersion(serverHost, serverPort) {
  if (HTTP_PORT === 0) {
    return undefined;
  }
  return await new Promise(resolve => {
    request(`http://${serverHost}:${serverPort}/package.json`, function(
      error,
      response,
      body
    ) {
      if (error || !response || response.statusCode !== 200) {
        return resolve(undefined);
      }
      try {
        return resolve(JSON.parse(body).version);
      } catch (err) {}
      return resolve(undefined);
    });
  });
}

async function listenIDECommands(callback) {
  if (IDECMDS_LISTENER_STATUS > 0) {
    return;
  }
  let coreVersion = '0.0.0';
  const coreVersionMsgId = Math.random().toString();
  const sock = new ws(`ws://${HTTP_HOST}:${HTTP_PORT}/wsrpc`, {
    perMessageDeflate: false
  });
  sock.onopen = () => {
    IDECMDS_LISTENER_STATUS = 1;
    sock.send(JSON.stringify(jsonrpc.request(coreVersionMsgId, 'core.version')));
  };

  sock.onclose = () => {
    IDECMDS_LISTENER_STATUS = 0;
  };

  sock.onmessage = event => {
    try {
      const result = jsonrpc.parse(event.data);
      switch (result.type) {
        case 'success':
          if (result.payload.id === coreVersionMsgId) {
            coreVersion = PEPverToSemver(result.payload.result);
          } else {
            callback(result.payload.result.method, result.payload.result.params);
          }
          break;

        case 'error':
          console.error('Errored result: ' + result.payload.toString());
          break;
      }
    } catch (err) {
      console.error('Invalid RPC message: ' + err.toString());
    }

    let data = null;
    if (semver.gte(coreVersion, '4.0.1-b.3')) {
      data = jsonrpc.request(Math.random().toString(), 'ide.listen_commands', [
        SESSION_ID
      ]);
    } else {
      data = jsonrpc.request(Math.random().toString(), 'ide.listen_commands');
    }
    sock.send(JSON.stringify(data));
  };
}

async function findFreePort() {
  let port = HTTP_PORT_BEGIN;
  let inUse = false;
  while (port < HTTP_PORT_END) {
    inUse = await new Promise(resolve => {
      tcpPortUsed.check(port, HTTP_HOST).then(
        result => {
          resolve(result);
        },
        () => {
          return resolve(false);
        }
      );
    });
    if (!inUse) {
      return port;
    }
    port++;
  }
  return 0;
}

export function isServerStarted() {
  return new Promise(resolve => {
    tcpPortUsed.check(HTTP_PORT, HTTP_HOST).then(
      result => {
        resolve(result);
      },
      () => {
        return resolve(false);
      }
    );
  });
}

export async function ensureServerStarted(options = {}) {
  const maxAttempts = 3;
  let attemptNums = 0;
  let lastError = undefined;
  let _port = 0;
  while (attemptNums < maxAttempts) {
    try {
      return await _ensureServerStarted(options);
    } catch (err) {
      lastError = err;
      console.warn(err);
      HTTP_PORT = 0;
      // stop all PIO Home servers
      _port = HTTP_PORT_BEGIN;
      while (_port < HTTP_PORT_END) {
        request
          .get(`http://${HTTP_HOST}:${_port}?__shutdown__=1`)
          .on('error', () => {});
        _port++;
      }
      await sleep(2000); // wait for 2 secs while server stops
    }
    attemptNums++;
  }
  reportError(lastError);
  throw lastError;
}

async function _ensureServerStarted(options = {}) {
  if (HTTP_PORT === 0) {
    HTTP_PORT = options.port || (await findFreePort());
  }
  const params = {
    host: HTTP_HOST,
    port: HTTP_PORT
  };
  if (!(await isServerStarted())) {
    await new Promise((resolve, reject) => {
      runPIOCommand(
        ['home', '--port', HTTP_PORT, '--no-open'],
        (code, stdout, stderr) => {
          if (code !== 0) {
            HTTP_PORT = 0;
            return reject(new Error(stderr));
          }
        }
      );
      tcpPortUsed.waitUntilUsed(HTTP_PORT, 500, SERVER_LAUNCH_TIMEOUT * 1000).then(
        () => {
          resolve(true);
        },
        err => {
          reject(new Error('Could not start PIO Home server: ' + err.toString()));
        }
      );
    });
  }
  if (options.onIDECommand) {
    listenIDECommands(options.onIDECommand);
  }
  return params;
}

export function shutdownServer() {
  if (!HTTP_PORT) {
    return;
  }
  return request.get(`http://${HTTP_HOST}:${HTTP_PORT}?__shutdown__=1`);
}

export function loadState() {
  const statePath = path.join(getCoreDir(), 'homestate.json');
  if (!fs.isFileSync(statePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (err) {
    console.warn(err);
    return null;
  }
}

export function showAtStartup(caller) {
  const state = loadState();
  return (
    !state ||
    !state.storage ||
    !state.storage.showOnStartup ||
    !(caller in state.storage.showOnStartup) ||
    state.storage.showOnStartup[caller]
  );
}
