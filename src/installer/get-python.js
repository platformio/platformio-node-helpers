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
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import semver from 'semver';
import stream from 'stream';
import tar from 'tar';
import zlib from 'zlib';

const HTTPS_CA_CERTIFICATES = `
# Issuer: CN=ISRG Root X1 O=Internet Security Research Group
# Subject: CN=ISRG Root X1 O=Internet Security Research Group
# Label: "ISRG Root X1"
# Serial: 172886928669790476064670243504169061120
# MD5 Fingerprint: 0c:d2:f9:e0:da:17:73:e9:ed:86:4d:a5:e3:70:e7:4e
# SHA1 Fingerprint: ca:bd:2a:79:a1:07:6a:31:f2:1d:25:36:35:cb:03:9d:43:29:a5:e8
# SHA256 Fingerprint: 96:bc:ec:06:26:49:76:f3:74:60:77:9a:cf:28:c5:a7:cf:e8:a3:c0:aa:e1:1a:8f:fc:ee:05:c0:bd:df:08:c6
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----

# Issuer: CN=USERTrust RSA Certification Authority O=The USERTRUST Network
# Subject: CN=USERTrust RSA Certification Authority O=The USERTRUST Network
# Label: "USERTrust RSA Certification Authority"
# Serial: 2645093764781058787591871645665788717
# MD5 Fingerprint: 1b:fe:69:d1:91:b7:19:33:a3:72:a8:0f:e1:55:e5:b5
# SHA1 Fingerprint: 2b:8f:1b:57:33:0d:bb:a2:d0:7a:6c:51:f7:0e:e9:0d:da:b9:ad:8e
# SHA256 Fingerprint: e7:93:c9:b0:2f:d8:aa:13:e2:1c:31:22:8a:cc:b0:81:19:64:3b:74:9c:89:89:64:b1:74:6d:46:c3:d4:cb:d2
-----BEGIN CERTIFICATE-----
MIIF3jCCA8agAwIBAgIQAf1tMPyjylGoG7xkDjUDLTANBgkqhkiG9w0BAQwFADCB
iDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0pl
cnNleSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNV
BAMTJVVTRVJUcnVzdCBSU0EgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwHhcNMTAw
MjAxMDAwMDAwWhcNMzgwMTE4MjM1OTU5WjCBiDELMAkGA1UEBhMCVVMxEzARBgNV
BAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0plcnNleSBDaXR5MR4wHAYDVQQKExVU
aGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNVBAMTJVVTRVJUcnVzdCBSU0EgQ2Vy
dGlmaWNhdGlvbiBBdXRob3JpdHkwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIK
AoICAQCAEmUXNg7D2wiz0KxXDXbtzSfTTK1Qg2HiqiBNCS1kCdzOiZ/MPans9s/B
3PHTsdZ7NygRK0faOca8Ohm0X6a9fZ2jY0K2dvKpOyuR+OJv0OwWIJAJPuLodMkY
tJHUYmTbf6MG8YgYapAiPLz+E/CHFHv25B+O1ORRxhFnRghRy4YUVD+8M/5+bJz/
Fp0YvVGONaanZshyZ9shZrHUm3gDwFA66Mzw3LyeTP6vBZY1H1dat//O+T23LLb2
VN3I5xI6Ta5MirdcmrS3ID3KfyI0rn47aGYBROcBTkZTmzNg95S+UzeQc0PzMsNT
79uq/nROacdrjGCT3sTHDN/hMq7MkztReJVni+49Vv4M0GkPGw/zJSZrM233bkf6
c0Plfg6lZrEpfDKEY1WJxA3Bk1QwGROs0303p+tdOmw1XNtB1xLaqUkL39iAigmT
Yo61Zs8liM2EuLE/pDkP2QKe6xJMlXzzawWpXhaDzLhn4ugTncxbgtNMs+1b/97l
c6wjOy0AvzVVdAlJ2ElYGn+SNuZRkg7zJn0cTRe8yexDJtC/QV9AqURE9JnnV4ee
UB9XVKg+/XRjL7FQZQnmWEIuQxpMtPAlR1n6BB6T1CZGSlCBst6+eLf8ZxXhyVeE
Hg9j1uliutZfVS7qXMYoCAQlObgOK6nyTJccBz8NUvXt7y+CDwIDAQABo0IwQDAd
BgNVHQ4EFgQUU3m/WqorSs9UgOHYm8Cd8rIDZsswDgYDVR0PAQH/BAQDAgEGMA8G
A1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEMBQADggIBAFzUfA3P9wF9QZllDHPF
Up/L+M+ZBn8b2kMVn54CVVeWFPFSPCeHlCjtHzoBN6J2/FNQwISbxmtOuowhT6KO
VWKR82kV2LyI48SqC/3vqOlLVSoGIG1VeCkZ7l8wXEskEVX/JJpuXior7gtNn3/3
ATiUFJVDBwn7YKnuHKsSjKCaXqeYalltiz8I+8jRRa8YFWSQEg9zKC7F4iRO/Fjs
8PRF/iKz6y+O0tlFYQXBl2+odnKPi4w2r78NBc5xjeambx9spnFixdjQg3IM8WcR
iQycE0xyNN+81XHfqnHd4blsjDwSXWXavVcStkNr/+XeTWYRUc+ZruwXtuhxkYze
Sf7dNXGiFSeUHM9h4ya7b6NnJSFd5t0dCy5oGzuCr+yDZ4XUmFF0sbmZgIn/f3gZ
XHlKYC6SQK5MNyosycdiyA5d9zZbyuAlJQG03RoHnHcAP9Dc1ew91Pq7P8yF1m9/
qS3fuQL39ZeatTXaw2ewh0qpKJ4jjv9cJ2vhsE/zB+4ALtRZh8tSQZXq9EfX7mRB
VXyNWQKV3WKdwrnuWih0hKWbt5DHDAff9Yk2dDLWKMGwsAvgnEzDHNb842m1R0aB
L6KCq9NjRHDEjf8tM7qtj3u1cIiuPhnPQCjY/MiQu12ZIvVS5ljFH4gxQ+6IHdfG
jjxDah2nGN59PRbxYvnKkKj9
-----END CERTIFICATE-----
`;

export async function findPythonExecutable() {
  const exenames = proc.IS_WINDOWS ? ['python.exe'] : ['python3', 'python'];
  const envPath = process.env.PLATFORMIO_PATH || process.env.PATH;
  const errors = [];
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
        errors.push(err);
      }
    }
  }
  for (const err of errors) {
    if (err.toString().includes('Could not find distutils module')) {
      throw err;
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

export async function installPortablePython(destinationDir, options = undefined) {
  const registryFile = await getRegistryFile();
  if (!registryFile) {
    throw new Error(`Could not find portable Python for ${proc.getSysType()}`);
  }
  const archivePath = await downloadRegistryFile(
    registryFile,
    core.getTmpDir(),
    options,
  );
  if (!archivePath) {
    throw new Error('Could not download portable Python');
  }
  try {
    await fs.promises.rmdir(destinationDir, {
      recursive: true,
    });
  } catch (err) {
    console.warn(err);
  }
  await extractTarGz(archivePath, destinationDir);
  await ensurePythonExeExists(destinationDir);
  return destinationDir;
}

async function getRegistryFile() {
  const systype = proc.getSysType();
  const data = await got(
    'https://api.registry.platformio.org/v3/packages/platformio/tool/python-portable',
    {
      timeout: 60 * 1000,
      retry: { limit: 5 },
      https: {
        certificateAuthority: HTTPS_CA_CERTIFICATES,
      },
    },
  ).json();
  const versions = data.versions.filter((version) =>
    isVersionSystemCompatible(version, systype),
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
  // ignore Python >=3.9 on <= Win7
  try {
    const originVersion = parseInt(version.name.split('.')[1]);
    if (
      proc.IS_WINDOWS &&
      originVersion >= 30900 &&
      semver.satisfies(os.release(), '<=6.1')
    ) {
      return false;
    }
  } catch (err) {
    console.warn(err);
  }

  for (const item of version.files) {
    if (item.system.includes(systype)) {
      return true;
    }
  }
  return false;
}

async function downloadRegistryFile(regfile, destinationDir, options = undefined) {
  options = options || {};
  let archivePath = undefined;

  if (options.predownloadedPackageDir) {
    archivePath = path.join(options.predownloadedPackageDir, regfile.name);
    if (
      await fileExistsAndChecksumMatches(archivePath, (regfile.checksum || {}).sha256)
    ) {
      console.info('Using predownloaded package from ' + archivePath);
      return archivePath;
    }
  }

  for await (const { url, checksum } of registryFileMirrorIterator(
    regfile.download_url,
  )) {
    archivePath = path.join(destinationDir, regfile.name);
    // if already downloaded
    if (await fileExistsAndChecksumMatches(archivePath, checksum)) {
      return archivePath;
    }
    const pipeline = promisify(stream.pipeline);
    try {
      await pipeline(
        got.stream(url, {
          https: {
            certificateAuthority: HTTPS_CA_CERTIFICATES,
          },
        }),
        fs.createWriteStream(archivePath),
      );
      if (await fileExistsAndChecksumMatches(archivePath, checksum)) {
        return archivePath;
      }
    } catch (err) {
      console.error(err);
    }
  }
}

async function* registryFileMirrorIterator(downloadUrl) {
  const visitedMirrors = [];
  while (true) {
    const response = await got.head(downloadUrl, {
      https: {
        certificateAuthority: HTTPS_CA_CERTIFICATES,
      },
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
        }),
      )
      .on('error', (err) => reject(err))
      .on('close', () => resolve(destination));
  });
}
