/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as misc from './misc';
import { getCoreDir, runPIOCommand } from './core';

import fs from 'fs';
import jsonrpc from 'jsonrpc-lite';
import path from 'path';
import qs from 'querystringify';
import request from 'request';
import semver from 'semver';
import tcpPortUsed from 'tcp-port-used';
import ws from 'ws';

const SERVER_LAUNCH_TIMEOUT = 5 * 60; // 5 minutes
const SERVER_AUTOSHUTDOWN_TIMEOUT = 3600; // 1 hour
const HTTP_HOST = '127.0.0.1';
const HTTP_PORT_BEGIN = 8010;
const HTTP_PORT_END = 8050;
const SESSION_ID = Math.round(Math.random() * 1000000);
let HTTP_PORT = 0;
let IDECMDS_LISTENER_STATUS = 0;

export function getFrontendUri(serverHost, serverPort, options) {
  const stateStorage = (loadState() || {}).storage || {};
  const params = {
    start: options.start || '/',
    theme: stateStorage.theme || options.theme,
    workspace: stateStorage.workspace || options.workspace,
    sid: SESSION_ID,
  };
  Object.keys(params).forEach((key) => {
    if ([undefined, null].includes(params[key])) {
      delete params[key];
    }
  });
  return `http://${serverHost}:${serverPort}?${qs.stringify(params)}`;
}

export async function getFrontendVersion(serverHost, serverPort) {
  return await new Promise((resolve) => {
    request(
      `http://${serverHost}:${serverPort}/package.json`,
      function (error, response, body) {
        if (error || !response || response.statusCode !== 200) {
          return resolve(undefined);
        }
        try {
          return resolve(JSON.parse(body).version);
        } catch (err) {}
        return resolve(undefined);
      }
    );
  });
}

async function listenIDECommands(callback) {
  if (IDECMDS_LISTENER_STATUS > 0) {
    return;
  }
  let coreVersion = '0.0.0';
  const coreVersionMsgId = Math.random().toString();
  const sock = new ws(`ws://${HTTP_HOST}:${HTTP_PORT}/wsrpc`, {
    perMessageDeflate: false,
  });
  sock.onopen = () => {
    IDECMDS_LISTENER_STATUS = 1;
    sock.send(JSON.stringify(jsonrpc.request(coreVersionMsgId, 'core.version')));
  };

  sock.onclose = () => {
    IDECMDS_LISTENER_STATUS = 0;
  };

  sock.onmessage = (event) => {
    try {
      const result = jsonrpc.parse(event.data);
      switch (result.type) {
        case 'success':
          if (result.payload.id === coreVersionMsgId) {
            coreVersion = misc.PEPverToSemver(result.payload.result);
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
    if (semver.gte(coreVersion, '4.0.1')) {
      data = jsonrpc.request(Math.random().toString(), 'ide.listen_commands', [
        SESSION_ID,
      ]);
    } else {
      data = jsonrpc.request(Math.random().toString(), 'ide.listen_commands');
    }
    sock.send(JSON.stringify(data));
  };
}

async function isPortUsed(host, port) {
  return new Promise((resolve) => {
    tcpPortUsed.check(port, host).then(
      (result) => {
        return resolve(result);
      },
      () => {
        return resolve(false);
      }
    );
  });
}

async function findFreePort() {
  let port = HTTP_PORT_BEGIN;
  while (port < HTTP_PORT_END) {
    if (!(await isPortUsed(HTTP_HOST, port))) {
      return port;
    }
    // reuse opened from other IDE window/session
    if (await getFrontendVersion(HTTP_HOST, port)) {
      return port;
    }
    port++;
  }
  return 0;
}

export async function isServerStarted() {
  if (!(await isPortUsed(HTTP_HOST, HTTP_PORT))) {
    return false;
  }
  return !!(await getFrontendVersion(HTTP_HOST, HTTP_PORT));
}

export async function ensureServerStarted(options = {}) {
  const maxAttempts = 3;
  let attemptNums = 0;
  let lastError = undefined;
  while (attemptNums < maxAttempts) {
    try {
      return await _ensureServerStarted(options);
    } catch (err) {
      lastError = err;
      console.warn(err);
      HTTP_PORT = 0;
      // stop all PIO Home servers
      await shutdownAllServers();
    }
    attemptNums++;
  }
  misc.reportError(lastError);
  throw lastError;
}

async function _ensureServerStarted(options = {}) {
  if (HTTP_PORT === 0) {
    HTTP_PORT = options.port || (await findFreePort());
  }
  const params = {
    host: HTTP_HOST,
    port: HTTP_PORT,
  };
  if (!(await isServerStarted())) {
    await new Promise((resolve, reject) => {
      runPIOCommand(
        [
          'home',
          '--port',
          HTTP_PORT,
          '--shutdown-timeout',
          SERVER_AUTOSHUTDOWN_TIMEOUT,
          '--no-open',
        ],
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
        (err) => {
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

export async function shutdownAllServers() {
  let port = HTTP_PORT_BEGIN;
  while (port < HTTP_PORT_END) {
    request.get(`http://${HTTP_HOST}:${port}?__shutdown__=1`).on('error', () => {});
    port++;
  }
  await misc.sleep(2000); // wait for 2 secs while server stops
}

function loadState() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(getCoreDir(), 'homestate.json'), 'utf8')
    );
  } catch (err) {}
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
