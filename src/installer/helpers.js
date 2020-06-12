/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as fs from 'fs';

import crypto from 'crypto';
import { promises as fsAsync } from 'fs';
import { getCommandOutput } from '../proc';
import request from 'request';
import tar from 'tar';
import zlib from 'zlib';

export async function download(source, target, retries = 3) {
  let checksum = undefined;
  if (source.includes('#')) {
    [source, checksum] = source.split('#', 2);
  }
  if (await fileExistsAndChecksumMatches(target, checksum)) {
    return target;
  }

  let lastError = '';
  while (retries >= 0) {
    try {
      await _download(source, target);
      if (await fileExistsAndChecksumMatches(target, checksum)) {
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

async function fileExistsAndChecksumMatches(filePath, checksum) {
  try {
    await fsAsync.access(filePath);
    if ((await calculateFileHashsum(filePath)) === checksum) {
      return true;
    }
    await fsAsync.unlink(filePath);
  } catch (err) {}
  return false;
}

async function calculateFileHashsum(filePath, algo = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algo);
    const fsStream = fs.createReadStream(filePath);
    fsStream.on('data', data => hash.update(data));
    fsStream.on('end', () => resolve(hash.digest('hex')));
    fsStream.on('error', err => reject(err));
  });
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

export async function extractTarGz(source, destination) {
  try {
    await fsAsync.access(destination);
  } catch (err) {
    await fsAsync.mkdir(destination, { recursive: true });
  }
  return await new Promise((resolve, reject) => {
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
