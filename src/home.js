/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { getHomeDir, runPIOCommand } from './core';

import SockJS from 'sockjs-client';
import fs from 'fs-plus';
import jsonrpc from 'jsonrpc-lite';
import path from 'path';
import qs from 'querystringify';
import request from 'request';
import tcpPortUsed from 'tcp-port-used';


const SERVER_LAUNCH_TIMEOUT = 5 * 60; // 5 minutes
const HTTP_HOST = '127.0.0.1';
let HTTP_PORT = 0;
let IDECMDS_LISTENER_STATUS = 0;

function listenIDECommands(callback) {
  if (IDECMDS_LISTENER_STATUS > 0) {
    return;
  }

  const reconnect = {
    timer: null,
    delay: 500,  // msec
    maxDelay: 10000,  // msec
    retries: 0
  };

  function newSocket(endpoint) {
    if (reconnect.timer) {
      clearTimeout(reconnect.timer);
    }
    const sock = new SockJS(endpoint);

    sock.onopen = () => {
      IDECMDS_LISTENER_STATUS = 1;
      reconnect.retries = 0;
      sock.send(JSON.stringify(jsonrpc.request(Math.random().toString(), 'ide.listen_commands')));
    };

    sock.onclose = () => {
      IDECMDS_LISTENER_STATUS = 0;
      // reconnect.retries++;
      // reconnect.interval = setTimeout(
      //   () => newSocket(endpoint),
      //   Math.min(reconnect.delay * reconnect.retries, reconnect.maxDelay)
      // );
    };

    sock.onmessage = event => {
      try {
        const result = jsonrpc.parse(event.data);
        switch (result.type) {
          case 'success':
            callback(result.payload.result.method, result.payload.result.params);
            break;

          case 'error':
            console.error('Errored result: ' + result.payload.toString());
            break;
        }
      } catch (err) {
        console.error('Invalid RPC message: ' + err.toString());
      }
      sock.send(JSON.stringify(jsonrpc.request(Math.random().toString(), 'ide.listen_commands')));
    };
    return sock;
  }

  newSocket(`http://${HTTP_HOST}:${HTTP_PORT}/wsrpc`);
}

async function findFreePort() {
  let port = 8010;
  let inUse = false;
  while (port < 9000) {
    inUse = await new Promise(resolve => {
      tcpPortUsed.check(port, HTTP_HOST)
        .then(inUse => {
          resolve(inUse);
        }, () => {
          return resolve(false);
        });
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
    tcpPortUsed.check(HTTP_PORT, HTTP_HOST)
      .then(inUse => {
        resolve(inUse);
      }, () => {
        return resolve(false);
      });
  });
}

export async function ensureServerStarted(options={}) {
  if (HTTP_PORT === 0) {
    HTTP_PORT = await findFreePort();
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
            return reject(stderr);
          }
        }
      );
      tcpPortUsed.waitUntilUsed(HTTP_PORT, 500, SERVER_LAUNCH_TIMEOUT * 1000)
        .then(() => {
          resolve(true);
        }, (err) => {
          reject('Could not start PIO Home server: ' + err.toString());
        });
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
  const statePath = path.join(getHomeDir(), 'homestate.json');
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
  return !state || !state.storage || !state.storage.showOnStartup || !state.storage.showOnStartup.hasOwnProperty(caller) || state.storage.showOnStartup[caller];
}

export function getFrontendUri(serverHost, serverPort, options) {
  const stateStorage = (loadState() || {}).storage || {};
  const params = {
    start: options.start || '/',
    theme: stateStorage.theme || options.theme,
    workspace: stateStorage.workspace || options.workspace
  };
  Object.keys(params).forEach(key => {
    if ([undefined, null].includes(params[key])) {
      delete params[key];
    }
  });
  return `http://${serverHost}:${serverPort}?${qs.stringify(params)}`;
}
