/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { promises as fs } from 'fs';
import got from 'got';
import os from 'os';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadJSON(filePath) {
  try {
    await fs.access(filePath);
    return JSON.parse(await fs.readFile(filePath, { encoding: 'utf-8' }));
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

export async function reportError(err) {
  const data = new URLSearchParams();
  data.set('v', 1);
  data.set('tid', 'UA-1768265-13');
  data.set('cid', uuid());
  data.set('aid', 'node.helpers');
  data.set('av', PACKAGE_VERSION);
  data.set('an', `${os.type()}, ${os.release()}, ${os.arch()}`);
  data.set('t', 'exception');
  data.set('exd', err.toString());
  data.set('exf', 1);
  if (process.env.PLATFORMIO_CALLER) {
    data.set('cd1', process.env.PLATFORMIO_CALLER);
  }
  await got.post('https://www.google-analytics.com/collect', {
    body: data.toString(),
    timeout: 2000,
  });
}

export function getErrorReportUrl(title, description) {
  const errorToUrls = [
    ['Multiple requests to rebuild the project', 'https://bit.ly/3mMTOgB'],
    ['WindowsError: [Error 5]', 'https://bit.ly/3GTAtlG'],
    ['[WinError 5]', 'https://bit.ly/3GTAtlG'],
    ['[WinError 225]', 'https://bit.ly/3GTAtlG'],
    ['Could not start PIO Home server: Error: timeout', 'https://bit.ly/2Yfl65C'],
    ['`venv` module', 'https://bit.ly/3bK6zlH'],
    ['after connection broken by', 'https://bit.ly/3q6StTV'],
    ['subprocess.CalledProcessError', 'https://bit.ly/3EFlxWq'],
    ['Can not find Python Interpreter', 'https://bit.ly/3wkz0Qv'],
    ['platformio-ide.useBuiltinPIOCore', 'https://bit.ly/3AhJHHe'],
    ['Could not start PIO Home server: Timeout error', 'https://bit.ly/3m2Tbl9'],
    ['Could not create PIO Core Virtual Environment', 'https://bit.ly/43hNh04'],
    ['Compatible PlatformIO Core not found', 'https://bit.ly/43tNj4C'],
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
  const qs = new URLSearchParams();
  qs.set('title', title);
  qs.set('body', description);
  qs.set('labels', 'auto');
  return `https://github.com/platformio/platformio-${repoName}/issues/new?${qs.toString()}`;
}
