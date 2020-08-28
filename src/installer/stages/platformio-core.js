/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as core from '../../core';
import * as home from '../../home';
import * as misc from '../../misc';
import * as proc from '../../proc';
import { download, extractTarGz } from '../helpers';

import BaseStage from './base';
import { callInstallerScript } from '../get-platformio';
import { promises as fs } from 'fs';
import path from 'path';
import tmp from 'tmp';

export default class PlatformIOCoreStage extends BaseStage {
  static PORTABLE_PYTHON_URLS = {
    windows_x86:
      'https://dl.bintray.com/platformio/dl-misc/python-portable-windows_x86-3.7.7.tar.gz#2e5845c2a1b06dd2832fe5341861b45e2ebaeea51d6bb42be241cf0319b61eb3',
    windows_amd64:
      'https://dl.bintray.com/platformio/dl-misc/python-portable-windows_amd64-3.7.7.tar.gz#61ff38127dd52bcec6ee93f2a6119faaf979a47bc0d62945fe6a56eaaaf76d06',
    darwin_x86_64:
      'https://dl.bintray.com/platformio/dl-misc/python-portable-darwin_x86_64-3.8.4.tar.gz#b1373e05815cd04b702dfcb2364c7b31e563b16d82bcb3a371ddc229b095b573',
  };

  static getBuiltInPythonDir() {
    return path.join(core.getCoreDir(), 'python3');
  }

  constructor() {
    super(...arguments);
    tmp.setGracefulCleanup();
  }

  get name() {
    return 'PlatformIO Core';
  }

  async check() {
    if (!this.params.useBuiltinPIOCore) {
      this.status = BaseStage.STATUS_SUCCESSED;
      return true;
    }
    try {
      await fs.access(core.getEnvBinDir());
    } catch (err) {
      throw new Error('PlatformIO Core has not been installed yet!');
    }
    // check that PIO Core is installed and load its state an patch OS environ
    await this.loadCoreState();
    this.status = BaseStage.STATUS_SUCCESSED;
    return true;
  }

  async install() {
    if (this.status === BaseStage.STATUS_SUCCESSED) {
      return true;
    }
    if (!this.params.useBuiltinPIOCore) {
      this.status = BaseStage.STATUS_SUCCESSED;
      return true;
    }
    this.status = BaseStage.STATUS_INSTALLING;
    try {
      // shutdown all PIO Home servers which block python.exe on Windows
      await home.shutdownAllServers();
      // run installer script
      const scriptArgs = [];
      if (this.useDevCore()) {
        scriptArgs.push('--dev');
      }
      console.info(await callInstallerScript(await this.whereIsPython(), scriptArgs));
      // check that PIO Core is installed and load its state an patch OS environ
      await this.loadCoreState();
      await this.installPIOHome();
    } catch (err) {
      misc.reportError(err);
      throw err;
    }
    return true;
  }

  useDevCore() {
    return (
      this.params.useDevelopmentPIOCore ||
      (this.params.pioCoreVersionSpec || '').includes('-')
    );
  }

  async loadCoreState() {
    const stateJSONPath = path.join(
      core.getTmpDir(),
      `core-dump-${Math.round(Math.random() * 100000)}.json`
    );
    const scriptArgs = [];
    if (this.useDevCore()) {
      scriptArgs.push('--dev');
    }
    scriptArgs.push(...['check', 'core', '--auto-upgrade']);
    scriptArgs.push(...['--dump-state', stateJSONPath]);
    if (this.params.pioCoreVersionSpec) {
      scriptArgs.push(...['--version-spec', this.params.pioCoreVersionSpec]);
    }
    console.info(await callInstallerScript(await this.whereIsPython(), scriptArgs));

    // Load PIO Core state
    const coreState = await misc.loadJSON(stateJSONPath);
    console.info('PIO Core State', coreState);
    core.setCoreState(coreState);
    await fs.unlink(stateJSONPath); // cleanup

    // Add PIO Core virtualenv to global PATH
    // Setup `platformio` CLI globally for a Node.JS process
    proc.extendOSEnvironPath([core.getEnvBinDir(), core.getEnvDir()]);

    return true;
  }

  async whereIsPython() {
    let status = this.params.pythonPrompt.STATUS_TRY_AGAIN;

    if (this.params.useBuiltinPython) {
      try {
        await this.configurePreBuiltPython();
      } catch (err) {
        console.warn(err);
      }
    }

    do {
      const pythonExecutable = await proc.findPythonExecutable();
      if (pythonExecutable) {
        return pythonExecutable;
      }
      const result = await this.params.pythonPrompt.prompt();
      status = result.status;
      if (status === this.params.pythonPrompt.STATUS_CUSTOMEXE) {
        proc.extendOSEnvironPath([path.dirname(result.pythonExecutable)]);
      }
    } while (status !== this.params.pythonPrompt.STATUS_ABORT);

    this.status = BaseStage.STATUS_FAILED;
    throw new Error(
      'Can not find Python Interpreter. Please install Python 3.5 or above manually'
    );
  }

  async ensurePythonExeExists(pythonDir) {
    const binDir = proc.IS_WINDOWS ? pythonDir : path.join(pythonDir, 'bin');
    for (const name of ['python.exe', 'python3', 'python']) {
      try {
        await fs.access(path.join(binDir, name));
        return true;
      } catch (err) {}
    }
    return false;
  }

  async configurePreBuiltPython() {
    const systype = proc.getSysType();
    const pythonTarGzUrl = PlatformIOCoreStage.PORTABLE_PYTHON_URLS[systype];
    if (!pythonTarGzUrl) {
      console.info(
        `There is no built-in Python for ${systype} platform, we will use a system Python`
      );
      return;
    }
    const builtInPythonDir = PlatformIOCoreStage.getBuiltInPythonDir();
    try {
      await this.ensurePythonExeExists(builtInPythonDir);
    } catch (err) {
      try {
        const tarballPath = await download(
          pythonTarGzUrl,
          path.join(core.getTmpDir(), path.basename(pythonTarGzUrl).split('#')[0])
        );
        await extractTarGz(tarballPath, builtInPythonDir);
        await this.ensurePythonExeExists(builtInPythonDir);
      } catch (err) {
        console.error(err);
        // cleanup
        try {
          await fs.rmdir(builtInPythonDir, { recursive: true });
        } catch (err) {}
      }
    }
    proc.extendOSEnvironPath([
      proc.IS_WINDOWS ? builtInPythonDir : path.join(builtInPythonDir, 'bin'),
    ]);
    return builtInPythonDir;
  }

  installPIOHome() {
    return new Promise((resolve) => {
      core.runPIOCommand(
        ['home', '--host', '__do_not_start__'],
        (code, stdout, stderr) => {
          if (code !== 0) {
            console.warn(stdout, stderr);
          }
          return resolve(true);
        }
      );
    });
  }
}
