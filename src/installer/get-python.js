/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as core from '../core';
import * as proc from '../proc';

import { callInstallerScript } from './get-platformio';
import crypto from 'crypto';
import fs from 'fs';
import got from 'got';
import path from 'path';
import { promisify } from 'util';
import semver from 'semver';
import stream from 'stream';
import tar from 'tar';
import zlib from 'zlib';

export async function findPythonExecutable() {
  const exenames = proc.IS_WINDOWS ? ['python.exe'] : ['python3', 'python'];
  const envPath = process.env.PLATFORMIO_PATH || process.env.PATH;
  for (const location of envPath.split(path.delimiter)) {
    for (const exename of exenames) {
      const executable = path.normalize(path.join(location, exename)).replace(/"/g, '');
      try {
        if (
          fs.existsSync(executable) &&
          (await callInstallerScript(executable, ['check', 'python']))
        ) {
          return executable;
        }
      } catch (err) {
        console.warn(executable, err);
      }
    }
  }
  return null;
}

async function ensurePythonExeExists(pythonDir) {
  const binDir = proc.IS_WINDOWS ? pythonDir : path.join(pythonDir, 'bin');
  for (const name of ['python.exe', 'python3', 'python']) {
    try {
      await fs.promises.access(path.join(binDir, name));
      return true;
    } catch (err) {}
  }
  throw new Error('Python executable does not exist!');
}

export async function installPortablePython(destinationDir) {
  const registryFile = await getRegistryFile();
  if (!registryFile) {
    throw new Error(`Could not find portable Python for ${proc.getSysType()}`);
  }
  const archivePath = await downloadRegistryFile(registryFile, core.getTmpDir());
  if (!archivePath) {
    throw new Error('Could not download portable Python');
  }
  await extractTarGz(archivePath, destinationDir);
  await ensurePythonExeExists(destinationDir);
  return destinationDir;
}

async function getRegistryFile() {
  const systype = proc.getSysType();
  const response = await got(
    'https://api.registry.platformio.org/v3/packages/platformio/tool/python-portable',
    { timeout: 60 * 1000, retry: { limit: 5 } }
  ).json();
  const versions = response.versions.filter((version) =>
    isVersionSystemCompatible(version, systype)
  );
  let bestVersion = undefined;
  for (const version of versions) {
    if (!bestVersion || semver.gt(version.name, bestVersion.name)) {
      bestVersion = version;
    }
  }
  if (!bestVersion) {
    return;
  }
  return bestVersion.files.find((item) => item.system.includes(systype));
}

function isVersionSystemCompatible(version, systype) {
  for (const item of version.files) {
    if (item.system.includes(systype)) {
      return true;
    }
  }
  return false;
}

async function downloadRegistryFile(regfile, destinationDir) {
  for await (const { url, checksum } of registryFileMirrorIterator(
    regfile.download_url
  )) {
    const archivePath = path.join(destinationDir, regfile.name);
    // if already downloaded
    if (await fileExistsAndChecksumMatches(archivePath, checksum)) {
      return archivePath;
    }
    const pipeline = promisify(stream.pipeline);
    await pipeline(got.stream(url), fs.createWriteStream(archivePath));
    if (await fileExistsAndChecksumMatches(archivePath, checksum)) {
      return archivePath;
    }
  }
}

async function* registryFileMirrorIterator(downloadUrl) {
  const visitedMirrors = [];
  while (true) {
    const response = await got.head(downloadUrl, {
      followRedirect: false,
      throwHttpErrors: false,
      timeout: 60 * 1000,
      retry: { limit: 5 },
      searchParams: visitedMirrors.length
        ? { bypass: visitedMirrors.join(',') }
        : undefined,
    });
    const stopConditions = [
      ![302, 307].includes(response.statusCode),
      !response.headers.location,
      !response.headers['x-pio-mirror'],
      visitedMirrors.includes(response.headers['x-pio-mirror']),
    ];
    if (stopConditions.some((cond) => cond)) {
      return;
    }
    visitedMirrors.push(response.headers['x-pio-mirror']);
    yield {
      url: response.headers.location,
      checksum: response.headers['x-pio-content-sha256'],
    };
  }
}

async function fileExistsAndChecksumMatches(filePath, checksum) {
  try {
    await fs.promises.access(filePath);
    if ((await calculateFileHashsum(filePath)) === checksum) {
      return true;
    }
    await fs.promises.unlink(filePath);
  } catch (err) {}
  return false;
}

async function calculateFileHashsum(filePath, algo = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algo);
    const fsStream = fs.createReadStream(filePath);
    fsStream.on('data', (data) => hash.update(data));
    fsStream.on('end', () => resolve(hash.digest('hex')));
    fsStream.on('error', (err) => reject(err));
  });
}

async function extractTarGz(source, destination) {
  try {
    await fs.promises.access(destination);
  } catch (err) {
    await fs.promises.mkdir(destination, { recursive: true });
  }
  return await new Promise((resolve, reject) => {
    fs.createReadStream(source)
      .pipe(zlib.createGunzip())
      .on('error', (err) => reject(err))
      .pipe(
        tar.extract({
          cwd: destination,
        })
      )
      .on('error', (err) => reject(err))
      .on('close', () => resolve(destination));
  });
}
