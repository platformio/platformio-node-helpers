/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as misc from './misc';
import { getCoreDir, runPIOCommand } from './core';

import WebSocket from 'ws'; // eslint-disable-line import/no-unresolved
import crypto from 'crypto';
import fs from 'fs';
import got from 'got';
import jsonrpc from 'jsonrpc-lite';
import path from 'path';
import qs from 'querystringify';
import tcpPortUsed from 'tcp-port-used';

const SERVER_LAUNCH_TIMEOUT = 30; // 30 seconds
const SERVER_AUTOSHUTDOWN_TIMEOUT = 3600; // 1 hour
const HTTP_PORT_BEGIN = 8010;
const HTTP_PORT_END = 8050;
const SESSION_ID = crypto
  .createHash('sha1')
  .update(crypto.randomBytes(512))
  .digest('hex');
let _HTTP_HOST = '127.0.0.1';
let _HTTP_PORT = 0;
let _IDECMDS_LISTENER_STATUS = 0;

export function constructServerUrl({
  scheme = 'http',
  host = undefined,
  port = undefined,
  path = undefined,
  query = undefined,
  includeSID = true,
} = {}) {
  return `${scheme}://${host || _HTTP_HOST}:${port || _HTTP_PORT}${
    includeSID ? `/session/${SESSION_ID}` : ''
  }${path || '/'}${query ? `?${qs.stringify(query)}` : ''}`;
}

export function getFrontendUrl(options) {
  const stateStorage = (loadState() || {}).storage || {};
  const params = {
    start: options.start || '/',
    theme: stateStorage.theme || options.theme,
    workspace: stateStorage.workspace || options.workspace,
  };
  Object.keys(params).forEach((key) => {
    if ([undefined, null].includes(params[key])) {
      delete params[key];
    }
  });
  return constructServerUrl({ query: params });
}

export async function getFrontendVersion() {
  try {
    return (
      await got(constructServerUrl({ path: '/package.json' }), { timeout: 1000 }).json()
    ).version;
  } catch (err) {}
}

async function listenIDECommands(callback) {
  if (_IDECMDS_LISTENER_STATUS > 0) {
    return;
  }
  const ws = new WebSocket(constructServerUrl({ scheme: 'ws', path: '/wsrpc' }), {
    perMessageDeflate: false,
  });
  ws.on('open', () => {
    _IDECMDS_LISTENER_STATUS = 1;
    // "ping" message to initiate 'ide.listen_commands'
    ws.send(JSON.stringify(jsonrpc.request(Math.random().toString(), 'core.version')));
  });
  ws.on('close', () => {
    _IDECMDS_LISTENER_STATUS = 0;
  });
  ws.on('message', async (data) => {
    try {
      const msg = jsonrpc.parse(data);
      if (msg.type === 'success' && msg.payload.result.method) {
        const result = await callback(
          msg.payload.result.method,
          msg.payload.result.params
        );
        ws.send(
          JSON.stringify(
            jsonrpc.request(Math.random().toString(), 'ide.on_command_result', [
              msg.payload.result.id,
              result,
            ])
          )
        );
      } else if (msg.type === 'error') {
        console.error('Errored WS result: ', msg.payload);
      }
    } catch (err) {
      console.error('Invalid RPC message: ', err);
    }
    ws.send(
      JSON.stringify(jsonrpc.request(Math.random().toString(), 'ide.listen_commands'))
    );
  });
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
    if (!(await isPortUsed(_HTTP_HOST, port))) {
      return port;
    }
    port++;
  }
  return 0;
}

export async function isServerStarted() {
  if (!(await isPortUsed(_HTTP_HOST, _HTTP_PORT))) {
    return false;
  }
  return !!(await getFrontendVersion());
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
      _HTTP_PORT = 0;
      // stop all PIO Home servers
      await shutdownAllServers();
    }
    attemptNums++;
  }
  misc.reportError(lastError);
  throw lastError;
}

async function _ensureServerStarted(options = {}) {
  if (_HTTP_PORT === 0) {
    _HTTP_PORT = options.port || (await findFreePort());
  }
  if (options.host) {
    _HTTP_HOST = options.host;
  }
  if (!(await isServerStarted())) {
    await new Promise((resolve, reject) => {
      runPIOCommand(
        [
          'home',
          '--port',
          _HTTP_PORT,
          '--host',
          _HTTP_HOST,
          '--session-id',
          SESSION_ID,
          '--shutdown-timeout',
          SERVER_AUTOSHUTDOWN_TIMEOUT,
          '--no-open',
        ],
        (code, stdout, stderr) => {
          if (code !== 0) {
            _HTTP_PORT = 0;
            return reject(new Error(stderr));
          }
        }
      );
      tcpPortUsed
        .waitUntilUsedOnHost(_HTTP_PORT, _HTTP_HOST, 500, SERVER_LAUNCH_TIMEOUT * 1000)
        .then(
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
  return true;
}

export async function shutdownServer() {
  if (!_HTTP_PORT) {
    return;
  }
  return await got.post(constructServerUrl({ path: '/__shutdown__' }), {
    timeout: 1000,
  });
}

export async function shutdownAllServers() {
  let port = HTTP_PORT_BEGIN;
  while (port < HTTP_PORT_END) {
    try {
      got(
        constructServerUrl({ port, includeSID: false, query: { __shutdown__: '1' } }),
        { timeout: 1000, throwHttpErrors: false }
      );
    } catch (err) {}
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
