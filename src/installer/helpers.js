/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import fs from 'fs';
import { getCommandOutput } from '../proc';
import request from 'request';
import tar from 'tar';
import zlib from 'zlib';

export async function download(source, target, retries = 3) {
  const contentLength = await getContentLength(source);

  if (fileExistsAndSizeMatches(target, contentLength)) {
    return target;
  }

  let lastError = '';
  while (retries >= 0) {
    try {
      await _download(source, target);
      if (fileExistsAndSizeMatches(target, contentLength)) {
        return target;
      }
    } catch (err) {
      lastError = err;
      console.warn(err);
    }
    retries--;
  }

  throw new Error(`Failed to download file ${source}: ${lastError}`);
}

function fileExistsAndSizeMatches(target, contentLength) {
  try {
    if (contentLength > 0 && contentLength == fs.statSync(target)['size']) {
      return true;
    }
    try {
      fs.unlinkSync(target);
    } catch (err) {
      console.warn(err);
    }
  } catch (err) {}
  return false;
}

async function _download(source, target) {
  let proxy = null;
  try {
    const apmPath = atom.packages.getApmPath();
    proxy = await getCommandOutput(apmPath, [
      '--no-color',
      'config',
      'get',
      'https-proxy'
    ]);
    proxy = proxy.trim();
    if (proxy === 'null') {
      proxy = null;
    }
  } catch (err) {}
  if (!proxy) {
    proxy =
      (process.env.HTTPS_PROXY && process.env.HTTPS_PROXY.trim()) ||
      (process.env.HTTP_PROXY && process.env.HTTP_PROXY.trim());
  }
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(target);
    const options = {
      url: source
    };
    if (proxy) {
      options.proxy = proxy;
    }
    request
      .get(options)
      .on('error', err => reject(err))
      .pipe(file);
    file.on('error', err => reject(err));
    file.on('finish', () => resolve(target));
  });
}

function getContentLength(url) {
  return new Promise(resolve => {
    request.head(
      {
        url
      },
      (err, response) => {
        if (
          err ||
          response.statusCode !== 200 ||
          !response.headers ||
          !response.headers['content-length']
        ) {
          resolve(-1);
        }
        resolve(parseInt(response.headers['content-length']));
      }
    );
  });
}

export function extractTarGz(source, destination) {
  try {
    fs.accessSync(destination);
  } catch (err) {
    fs.mkdirSync(destination, { recursive: true });
  }
  return new Promise((resolve, reject) => {
    fs.createReadStream(source)
      .pipe(zlib.createGunzip())
      .on('error', err => reject(err))
      .pipe(
        tar.extract({
          cwd: destination
        })
      )
      .on('error', err => reject(err))
      .on('close', () => resolve(destination));
  });
}
