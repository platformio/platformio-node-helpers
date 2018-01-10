/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import fs from 'fs-plus';
import request from 'request';
import { runCommand } from '../misc';
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
      console.error(err);
    }
    retries--;
  }

  throw new Error(`Failed to download file ${source}: ${lastError}`);
}

function fileExistsAndSizeMatches(target, contentLength) {
  if (fs.isFileSync(target)) {
    if (contentLength > 0 && contentLength == fs.getSizeSync(target)) {
      return true;
    }
    try {
      fs.removeSync(target);
    } catch (err) {
      console.error(err);
    }
  }
  return false;
}

async function _download(source, target) {
  let proxy = null;
  try {
    const apmPath = atom.packages.getApmPath();
    proxy = await new Promise((resolve, reject) => {
      runCommand(
        apmPath,
        ['--no-color', 'config', 'get', 'https-proxy'],
        (code, stdout) => {
          if (code !== 0) {
            return reject(null);
          }
          resolve(stdout.trim() === 'null' ? null : stdout.trim());
        }
      );
    });
  } catch (err) {
    proxy = (process.env.HTTPS_PROXY && process.env.HTTPS_PROXY.trim()
    || process.env.HTTP_PROXY && process.env.HTTP_PROXY.trim());
  }
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(target);
    const options = {
      url: source,
    };
    if (proxy) {
      options.proxy = proxy;
    }
    request.get(options)
      .on('error', err => reject(err))
      .pipe(file);
    file.on('error', err => reject(err));
    file.on('finish', () => resolve(target));
  });
}

function getContentLength(url) {
  return new Promise(resolve => {
    request.head({
      url
    }, (err, response) => {
      if (err || response.statusCode !== 200 || !response.headers.hasOwnProperty('content-length')) {
        resolve(-1);
      }
      resolve(parseInt(response.headers['content-length']));
    });
  });
}

export function extractTarGz(source, destination) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(source)
      .pipe(zlib.createGunzip())
      .on('error', err => reject(err))
      .pipe(tar.extract({
        cwd: destination
      }))
      .on('error', err => reject(err))
      .on('close', () => resolve(destination));
  });
}

export function PEPverToSemver(pepver) {
  return pepver.replace(/(\.\d+)\.?(dev|a|b|rc|post)/, '$1-$2.');
}
