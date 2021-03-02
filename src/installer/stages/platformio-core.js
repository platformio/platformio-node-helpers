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

import BaseStage from './base';
import { callInstallerScript } from '../get-platformio';
import { promises as fs } from 'fs';
import { installPortablePython } from '../get-python';
import path from 'path';
import tmp from 'tmp';

export default class PlatformIOCoreStage extends BaseStage {
  static getBuiltInPythonDir() {
    return path.join(core.getCoreDir(), 'python3');
  }

  constructor() {
    super(...arguments);
    tmp.setGracefulCleanup();
    this.configureBuiltInPython();
  }

  get name() {
    return 'PlatformIO Core';
  }

  configureBuiltInPython() {
    if (!this.params.useBuiltinPython || !this.params.useBuiltinPIOCore) {
      return;
    }
    const builtInPythonDir = PlatformIOCoreStage.getBuiltInPythonDir();
    proc.extendOSEnvironPath('PLATFORMIO_PATH', [
      proc.IS_WINDOWS ? builtInPythonDir : path.join(builtInPythonDir, 'bin'),
    ]);
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

  async install(withProgress = undefined) {
    if (!withProgress) {
      withProgress = () => {};
    }

    if (this.status === BaseStage.STATUS_SUCCESSED) {
      return true;
    }
    if (!this.params.useBuiltinPIOCore) {
      this.status = BaseStage.STATUS_SUCCESSED;
      return true;
    }
    this.status = BaseStage.STATUS_INSTALLING;
    withProgress('Preparing for installation', 10);

    try {
      // shutdown all PIO Home servers which block python.exe on Windows
      await home.shutdownAllServers();

      if (this.params.useBuiltinPython) {
        withProgress('Downloading portable Python interpreter', 10);
        try {
          await installPortablePython(PlatformIOCoreStage.getBuiltInPythonDir());
        } catch (err) {
          console.warn(err);
          // cleanup
          try {
            await fs.rmdir(PlatformIOCoreStage.getBuiltInPythonDir(), {
              recursive: true,
            });
          } catch (err) {}
        }
      }

      withProgress('Installing PlatformIO Core', 20);
      const scriptArgs = [];
      if (this.useDevCore()) {
        scriptArgs.push('--dev');
      }
      console.info(await callInstallerScript(await this.whereIsPython(), scriptArgs));

      // check that PIO Core is installed and load its state an patch OS environ
      withProgress('Loading PlatformIO Core state', 40);
      await this.loadCoreState();

      withProgress('Installing PlatformIO Home', 10);
      await this.installPIOHome();
    } catch (err) {
      misc.reportError(err);
      throw err;
    }

    withProgress('Completed!', 10);
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
    scriptArgs.push(
      ...[
        'check',
        'core',
        this.params.disableAutoUpdates ? '--no-auto-upgrade' : '--auto-upgrade',
      ]
    );
    if (this.params.pioCoreVersionSpec) {
      scriptArgs.push(...['--version-spec', this.params.pioCoreVersionSpec]);
    }
    scriptArgs.push(...['--dump-state', stateJSONPath]);
    console.info(await callInstallerScript(await this.whereIsPython(), scriptArgs));

    // Load PIO Core state
    const coreState = await misc.loadJSON(stateJSONPath);
    console.info('PIO Core State', coreState);
    core.setCoreState(coreState);
    await fs.unlink(stateJSONPath); // cleanup

    // Add PIO Core virtualenv to global PATH
    // Setup `platformio` CLI globally for a Node.JS process
    proc.extendOSEnvironPath('PLATFORMIO_PATH', [
      core.getEnvBinDir(),
      core.getEnvDir(),
    ]);

    return true;
  }

  async whereIsPython() {
    let status = this.params.pythonPrompt.STATUS_TRY_AGAIN;
    this.configurePortablePython();

    do {
      const pythonExecutable = await proc.findPythonExecutable();
      if (pythonExecutable) {
        return pythonExecutable;
      }
      const result = await this.params.pythonPrompt.prompt();
      status = result.status;
      if (status === this.params.pythonPrompt.STATUS_CUSTOMEXE) {
        proc.extendOSEnvironPath('PLATFORMIO_PATH', [
          path.dirname(result.pythonExecutable),
        ]);
      }
    } while (status !== this.params.pythonPrompt.STATUS_ABORT);

    this.status = BaseStage.STATUS_FAILED;
    throw new Error(
      'Can not find Python Interpreter. Please install Python 3.6 or above manually'
    );
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
