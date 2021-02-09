/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { promises as fs } from 'fs';
import os from 'os';
import qs from 'querystringify';
import request from 'request';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function processHTTPRequest(url, callback, options) {
  options = options || {};
  options.url = url;
  if (!options.headers) {
    options.headers = {
      'User-Agent': 'PlatformIO',
    };
  }
  console.info('processHTTPRequest', options);
  return request(options, (err, response, body) => {
    return callback(err, response, body);
  });
}

export async function loadJSON(filePath) {
  try {
    await fs.access(filePath);
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    console.error(err);
    return null;
  }
}

export function arrayRemove(array, element) {
  return array.splice(array.indexOf(element), 1);
}

export function disposeSubscriptions(subscriptions) {
  while (subscriptions.length) {
    subscriptions.pop().dispose();
  }
}

export function PEPverToSemver(pepver) {
  return pepver.replace(/(\.\d+)\.?(dev|a|b|rc|post)/, '$1-$2.');
}

function uuid() {
  const s4 = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

export function reportError(err) {
  const data = {
    v: 1,
    tid: 'UA-1768265-13',
    cid: uuid(),
    aid: 'node.helpers',
    av: PACKAGE_VERSION,
    an: `${os.type()}, ${os.release()}, ${os.arch()}`,
    t: 'exception',
    exd: err.toString(),
    exf: 1,
  };
  if (process.env.PLATFORMIO_CALLER) {
    data['cd1'] = process.env.PLATFORMIO_CALLER;
  }
  request.post('https://www.google-analytics.com/collect', {
    body: qs.stringify(data),
  });
}

export function getErrorReportUrl(title, description) {
  const errorToUrls = [
    [
      'Multiple requests to rebuild the project',
      'https://github.com/platformio/platformio-vscode-ide/issues/2363',
    ],
    [
      'WindowsError: [Error 5]',
      'https://github.com/platformio/platformio-vscode-ide/issues/884',
    ],
    [
      'Could not start PIO Home server: Error: timeout',
      'https://github.com/platformio/platformio-vscode-ide/issues/205',
    ],
    [
      'python3-distutils',
      'https://github.com/platformio/platformio-core-installer/issues/85',
    ],
    [
      'after connection broken by',
      'https://github.com/platformio/platformio-core-installer/issues/152',
    ],
    [
      'subprocess.CalledProcessError',
      'https://github.com/platformio/platformio-core-installer/issues/221',
    ],
  ];
  for (const item of errorToUrls) {
    if (description.includes(item[0])) {
      return item[1];
    }
  }
  let repoName = `${process.env.PLATFORMIO_CALLER || 'vscode'}-ide`;
  if (title.includes('Installation Manager')) {
    repoName = 'core-installer';
  }
  return `https://github.com/platformio/platformio-${repoName}/issues/new?${qs.stringify(
    {
      title,
      body: description,
      labels: 'auto',
    }
  )}`;
}
