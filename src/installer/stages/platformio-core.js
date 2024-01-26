/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as core from '../../core';
import * as misc from '../../misc';
import * as proc from '../../proc';
import { findPythonExecutable, installPortablePython } from '../get-python';

import BaseStage from './base';
import { callInstallerScript } from '../get-platformio';
import { promises as fs } from 'fs';
import path from 'path';

export default class PlatformIOCoreStage extends BaseStage {
  static getBuiltInPythonDir() {
    return path.join(core.getCoreDir(), 'python3');
  }

  constructor() {
    super(...arguments);
    this.configureBuiltInPython();
  }

  get name() {
    return 'PlatformIO Core';
  }

  configureBuiltInPython() {
    if (!this.params.useBuiltinPython) {
      return;
    }
    const builtInPythonDir = PlatformIOCoreStage.getBuiltInPythonDir();
    proc.extendOSEnvironPath('PLATFORMIO_PATH', [
      proc.IS_WINDOWS ? builtInPythonDir : path.join(builtInPythonDir, 'bin'),
    ]);
  }

  async check() {
    if (this.params.useBuiltinPIOCore) {
      try {
        await fs.access(core.getEnvBinDir());
      } catch (err) {
        throw new Error('PlatformIO Core has not been installed yet!');
      }
    }
    // check that PIO Core is installed
    await this.loadCoreState();

    // check if outdated built-in Python
    if (await this.isBuiltinPythonOutdated()) {
      return false;
    }

    // Setup `platformio` CLI globally for a Node.JS process
    if (this.params.useBuiltinPIOCore) {
      proc.extendOSEnvironPath('PLATFORMIO_PATH', [
        core.getEnvBinDir(),
        core.getEnvDir(),
      ]);
    }
    this.status = BaseStage.STATUS_SUCCESSED;
    return true;
  }

  async loadCoreState() {
    const stateJSONPath = path.join(
      core.getTmpDir(),
      `core-dump-${Math.round(Math.random() * 100000)}.json`,
    );
    const scriptArgs = [];
    if (this.useDevCore()) {
      scriptArgs.push('--dev');
    }
    scriptArgs.push(
      ...[
        'check',
        'core',
        this.params.disableAutoUpdates || !this.params.useBuiltinPIOCore
          ? '--no-auto-upgrade'
          : '--auto-upgrade',
      ],
    );
    if (this.params.pioCoreVersionSpec) {
      scriptArgs.push(...['--version-spec', this.params.pioCoreVersionSpec]);
    }
    if (!this.params.useBuiltinPIOCore) {
      scriptArgs.push('--global');
    }
    scriptArgs.push(...['--dump-state', stateJSONPath]);
    console.info(await callInstallerScript(await this.whereIsPython(), scriptArgs));

    // Load PIO Core state
    const coreState = await misc.loadJSON(stateJSONPath);
    console.info('PIO Core State', coreState);
    core.setCoreState(coreState);
    await fs.unlink(stateJSONPath); // cleanup
    return true;
  }

  useDevCore() {
    return (
      this.params.useDevelopmentPIOCore ||
      (this.params.pioCoreVersionSpec || '').includes('-')
    );
  }

  async isBuiltinPythonOutdated() {
    if (!this.params.useBuiltinPython) {
      return false;
    }
    const builtInPythonDir = PlatformIOCoreStage.getBuiltInPythonDir();
    const coreState = core.getCoreState();
    try {
      await fs.access(builtInPythonDir);
      if (!coreState.python_version.startsWith('3.9.')) {
        throw new Error('Not 3.9 Python in penv');
      }
      const pkgVersion = (
        await misc.loadJSON(path.join(builtInPythonDir, 'package.json'))
      ).version;
      if (!pkgVersion.startsWith('1.309')) {
        throw new Error('Not 3.9 Python package');
      }
    } catch (err) {
      return false;
    }
    if ((coreState.system || '').startsWith('windows')) {
      try {
        await fs.unlink(path.join(builtInPythonDir, 'python.exe'));
      } catch (err) {
        return false;
      }
    }
    console.info('Upgrading built-in Python...');
    return true;
  }

  async whereIsPython({ prompt = false } = {}) {
    let status = this.params.pythonPrompt.STATUS_TRY_AGAIN;
    this.configureBuiltInPython();

    if (!prompt) {
      return await findPythonExecutable();
    }

    do {
      const pythonExecutable = await findPythonExecutable();
      if (pythonExecutable) {
        return pythonExecutable;
      }
      const result = await this.params.pythonPrompt.prompt();
      status = result.status;
      if (
        status === this.params.pythonPrompt.STATUS_CUSTOMEXE &&
        result.pythonExecutable
      ) {
        proc.extendOSEnvironPath('PLATFORMIO_PATH', [
          path.dirname(result.pythonExecutable),
        ]);
      }
    } while (status !== this.params.pythonPrompt.STATUS_ABORT);

    this.status = BaseStage.STATUS_FAILED;
    throw new Error(
      'Can not find Python Interpreter. Please install Python 3.6 or above manually',
    );
  }

  async install(withProgress = undefined) {
    if (this.status === BaseStage.STATUS_SUCCESSED) {
      return true;
    }
    if (!this.params.useBuiltinPIOCore) {
      this.status = BaseStage.STATUS_FAILED;
      throw new Error(
        'Could not find compatible PlatformIO Core. Please enable `platformio-ide.useBuiltinPIOCore` setting and restart IDE.',
      );
    }
    this.status = BaseStage.STATUS_INSTALLING;

    if (!withProgress) {
      withProgress = () => {};
    }
    withProgress('Preparing for installation', 10);
    try {
      if (this.params.useBuiltinPython) {
        withProgress('Downloading portable Python interpreter', 10);
        try {
          await installPortablePython(PlatformIOCoreStage.getBuiltInPythonDir(), {
            predownloadedPackageDir: this.params.predownloadedPackageDir,
          });
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
      console.info(
        await callInstallerScript(
          await this.whereIsPython({ prompt: true }),
          scriptArgs,
        ),
      );

      // check that PIO Core is installed and load its state an patch OS environ
      withProgress('Loading PlatformIO Core state', 40);
      await this.loadCoreState();

      withProgress('Installing PlatformIO Home', 80);
      await this.installPIOHome();
    } catch (err) {
      misc.reportError(err);
      throw err;
    }

    withProgress('Completed!', 100);
    return true;
  }

  async installPIOHome() {
    try {
      await core.getPIOCommandOutput(['home', '--host', '__do_not_start__']);
    } catch (err) {
      console.warn(err);
    }
  }
}
