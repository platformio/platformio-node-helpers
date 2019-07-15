/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as core from '../../core';
import * as helpers from '../helpers';
import * as misc from '../../misc';

import BaseStage from './base';
import fs from 'fs-plus';
import path from 'path';
import semver from 'semver';
import tmp from 'tmp';


export default class PlatformIOCoreStage extends BaseStage {

  static UPGRADE_PIOCORE_TIMEOUT = 86400 * 7 * 1000; // 7 days

  static pythonVersion = '2.7.13';
  static pipUrl = 'https://files.pythonhosted.org/packages/45/ae/8a0ad77defb7cc903f09e551d88b443304a9bd6e6f124e75c0fbbf6de8f7/pip-18.1.tar.gz';
  static virtualenvUrl = 'https://files.pythonhosted.org/packages/4e/8b/75469c270ac544265f0020aa7c4ea925c5284b23e445cf3aa8b99f662690/virtualenv-16.1.0.tar.gz';
  static pioCoreDevelopUrl = 'https://github.com/platformio/platformio/archive/develop.zip';

  constructor() {
    super(...arguments);
    tmp.setGracefulCleanup();
  }

  get name() {
    return 'PlatformIO Core';
  }

  async whereIsPython() {
    let status = this.params.pythonPrompt.STATUS_TRY_AGAIN;
    do {
      const pythonExecutable = await misc.getPythonExecutable(this.params.useBuiltinPIOCore);
      if (pythonExecutable) {
        return pythonExecutable;
      }

      if (process.platform.startsWith('win')) {
        try {
          return await this.installPythonForWindows();
        } catch (err) {
          console.warn(err);
        }
      }

      const result = await this.params.pythonPrompt.prompt();
      status = result.status;
      if (status === this.params.pythonPrompt.STATUS_CUSTOMEXE) {
        return result.pythonExecutable;
      }
    } while (status !== this.params.pythonPrompt.STATUS_ABORT);

    this.status = BaseStage.STATUS_FAILED;
    throw new Error('Can not find Python Interpreter');
  }

  async installPythonForWindows() {
    // https://www.python.org/ftp/python/2.7.14/python-2.7.14.msi
    // https://www.python.org/ftp/python/2.7.14/python-2.7.14.amd64.msi
    const pythonArch = process.arch === 'x64' ? '.amd64' : '';
    const msiUrl = `https://www.python.org/ftp/python/${PlatformIOCoreStage.pythonVersion}/python-${PlatformIOCoreStage.pythonVersion}${pythonArch}.msi`;
    const msiInstaller = await helpers.download(
      msiUrl,
      path.join(core.getCacheDir(), path.basename(msiUrl))
    );
    const targetDir = path.join(core.getHomeDir(), 'python27');
    const pythonPath = path.join(targetDir, 'python.exe');

    if (!fs.isFileSync(pythonPath)) {
      try {
        await this.installPythonFromWindowsMSI(msiInstaller, targetDir);
      } catch (err) {
        console.warn(err);
        await this.installPythonFromWindowsMSI(msiInstaller, targetDir, true);
      }
    }

    // append temporary to system environment
    process.env.PATH = [targetDir, path.join(targetDir, 'Scripts'), process.env.PATH].join(path.delimiter);
    process.env.Path = process.env.PATH;

    // install virtualenv
    return new Promise(resolve => {
      misc.runCommand(
        'pip',
        ['install', 'virtualenv'],
        () => resolve(pythonPath)
      );
    });
  }

  async installPythonFromWindowsMSI(msiInstaller, targetDir, administrative = false) {
    const logFile = path.join(core.getCacheDir(), 'python27msi.log');
    await new Promise((resolve, reject) => {
      misc.runCommand(
        'msiexec.exe',
        [administrative ? '/a' : '/i', `"${msiInstaller}"`, '/qn', '/li', `"${logFile}"`, `TARGETDIR="${targetDir}"`],
        (code, stdout, stderr) => {
          if (code === 0) {
            return resolve(stdout);
          } else {
            if (fs.isFileSync(logFile)) {
              stderr = fs.readFileSync(logFile).toString();
            }
            return reject(new Error(`MSI Python2.7: ${stderr}`));
          }
        },
        {
          spawnOptions: {
            shell: true
          }
        }
      );
    });
    if (!fs.isFileSync(path.join(targetDir, 'python.exe'))) {
      throw new Error('Could not install Python 2.7 using MSI');
    }
  }

  cleanVirtualEnvDir() {
    const envDir = core.getEnvDir();
    if (!fs.isDirectorySync(envDir)) {
      return true;
    }
    try {
      fs.removeSync(envDir);
      return true;
    } catch (err) {
      console.warn(err);
      return false;
    }
  }

  isCondaInstalled() {
    return new Promise(resolve => {
      misc.runCommand('conda', ['--version'], code => resolve(code === 0));
    });
  }

  createVirtualenvWithConda() {
    this.cleanVirtualEnvDir();
    return new Promise((resolve, reject) => {
      misc.runCommand(
        'conda',
        ['create', '--yes', '--quiet', 'python=2', 'pip', '--prefix', core.getEnvDir()],
        (code, stdout, stderr) => {
          if (code === 0) {
            return resolve(stdout);
          } else {
            return reject(new Error(`Conda Virtualenv: ${stderr}`));
          }
        }
      );
    });
  }

  async createVirtualenvWithLocal() {
    const pythonExecutable = await this.whereIsPython();
    const venvCmdOptions = [
      [pythonExecutable, '-m', 'venv', core.getEnvDir()],
      [pythonExecutable, '-m', 'virtualenv', '-p', pythonExecutable, core.getEnvDir()],
      ['virtualenv', '-p', pythonExecutable, core.getEnvDir()]
      [pythonExecutable, '-m', 'virtualenv', core.getEnvDir()],
      ['virtualenv', core.getEnvDir()]
    ];
    let lastError = null;
    for (const cmdOptions of venvCmdOptions) {
      this.cleanVirtualEnvDir();
      try {
        return await new Promise((resolve, reject) => {
          misc.runCommand(
            cmdOptions[0], cmdOptions.slice(1),
            (code, stdout, stderr) => {
              return code === 0 ? resolve(stdout) : reject(new Error(`User's Virtualenv: ${stderr}`));
            }
          );
        });
      } catch (err) {
        console.warn(err);
        lastError = err;
      }
    }

    throw lastError;
  }

  async createVirtualenvWithDownload() {
    this.cleanVirtualEnvDir();
    const archivePath = await helpers.download(
      PlatformIOCoreStage.virtualenvUrl,
      path.join(core.getCacheDir(), 'virtualenv.tar.gz')
    );
    const tmpDir = tmp.dirSync({
      dir: core.getCacheDir(),
      unsafeCleanup: true
    }).name;
    const dstDir = await helpers.extractTarGz(archivePath, tmpDir);
    const virtualenvScript = fs.listTreeSync(dstDir).find(
      item => path.basename(item) === 'virtualenv.py');
    if (!virtualenvScript) {
      throw new Error('Can not find virtualenv.py script');
    }
    const pythonExecutable = await this.whereIsPython();
    return new Promise((resolve, reject) => {
      misc.runCommand(
        pythonExecutable,
        [virtualenvScript, core.getEnvDir()],
        (code, stdout, stderr) => {
          try {
            fs.removeSync(tmpDir);
          } catch (err) {
            console.warn(err);
          }
          if (code === 0) {
            return resolve(stdout);
          } else {
            let userNotification = `Virtualenv Create: ${stderr}\n${stdout}`;
            if (stderr.includes('WindowsError: [Error 5]')) {
              userNotification = `If you use Antivirus, it can block PlatformIO Installer. Try to disable it for a while.\n\n${userNotification}`;
            }
            return reject(new Error(userNotification));
          }
        }
      );
    });
  }

  async installVirtualenvPackage() {
    const pythonExecutable = await this.whereIsPython();
    return new Promise((resolve, reject) => {
      misc.runCommand(
        pythonExecutable,
        ['-m', 'pip', 'install', 'virtualenv'],
        (code, stdout, stderr) => {
          if (code === 0) {
            return resolve(stdout);
          } else {
            return reject(new Error(`Install Virtualenv globally: ${stderr}`));
          }
        }
      );
    });
  }

  async createVirtualenv() {
    if (await this.isCondaInstalled()) {
      return await this.createVirtualenvWithConda();
    }
    try {
      await this.createVirtualenvWithLocal();
    } catch (err) {
      console.warn(err);
      try {
        await this.createVirtualenvWithDownload();
      } catch (errDl) {
        console.warn(errDl);
        try {
          await this.installVirtualenvPackage();
          await this.createVirtualenvWithLocal();
        } catch (errPkg) {
          misc.reportError(errDl);
          console.warn(errPkg);
          throw new Error(`Could not create PIO Core Virtual Environment. Please create it manually -> http://bit.ly/pio-core-virtualenv \n ${errDl.toString()}`);
        }
      }
    }
  }

  async upgradePIP(pythonExecutable) {
    // we use manual downloading to resolve SSL issue with old `pip`
    const pipArchive = await helpers.download(
      PlatformIOCoreStage.pipUrl,
      path.join(core.getCacheDir(), path.basename(PlatformIOCoreStage.pipUrl))
    );
    return new Promise((resolve, reject) => {
      misc.runCommand(pythonExecutable, ['-m', 'pip', 'install', '-U', pipArchive], (code, stdout, stderr) => {
        return code === 0 ? resolve(stdout) : reject(stderr);
      });
    });
  }

  async installPIOCore() {
    const pythonExecutable = await this.whereIsPython();

    // Try to upgrade PIP to the latest version with updated openSSL
    try {
      await this.upgradePIP(pythonExecutable);
    } catch (err) {
      console.warn(err);
      misc.reportError(new Error(`Upgrade PIP: ${err.toString()}`));
    }

    // Install dependencies
    const args = ['-m', 'pip', 'install', '-U'];
    if (this.params.useDevelopmentPIOCore) {
      args.push(PlatformIOCoreStage.pioCoreDevelopUrl);
    } else {
      args.push('platformio');
    }
    return new Promise((resolve, reject) => {
      misc.runCommand(pythonExecutable, args, (code, stdout, stderr) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          if (misc.IS_WINDOWS) {
            stderr = `If you have antivirus/firewall/defender software in a system, try to disable it for a while. \n ${stderr}`;
          }
          return reject(new Error(`PIP Core: ${stderr}`));
        }
      });
    });
  }

  installPIOHome() {
    return new Promise(resolve => {
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

  initState() {
    let state = this.state;
    if (!state || !state.hasOwnProperty('pioCoreChecked') || !state.hasOwnProperty('lastIDEVersion')) {
      state = {
        pioCoreChecked: 0,
        lastIDEVersion: null
      };
    }
    return state;
  }

  async autoUpgradePIOCore(currentCoreVersion) {
    const newState = this.initState();
    const now = new Date().getTime();
    if (
      (process.env.PLATFORMIO_IDE && newState.lastIDEVersion && newState.lastIDEVersion !== process.env.PLATFORMIO_IDE)
      || ((now - PlatformIOCoreStage.UPGRADE_PIOCORE_TIMEOUT) > parseInt(newState.pioCoreChecked))
    ) {
      newState.pioCoreChecked = now;
      // PIO Core
      await new Promise(resolve => {
        core.runPIOCommand(
          ['upgrade', ...(this.params.useDevelopmentPIOCore && !semver.prerelease(currentCoreVersion) ? ['--dev'] : [])],
          (code, stdout, stderr) => {
            if (code !== 0) {
              console.warn(stdout, stderr);
            }
            resolve(true);
          }
        );
      });
    }
    newState.lastIDEVersion = process.env.PLATFORMIO_IDE;
    this.state = newState;
  }

  async check() {
    const coreVersion = helpers.PEPverToSemver(await core.getVersion());

    if (this.params.useBuiltinPIOCore) {
      if (!fs.isDirectorySync(core.getEnvBinDir())) {
        throw new Error('Virtual environment is not created');
      }
      else if (semver.lt(coreVersion, '3.5.0-rc.4')) {
        throw new Error('Force new python environment');
      }
      try {
        await this.autoUpgradePIOCore(coreVersion);
      } catch (err) {
        console.warn(err);
      }
    }

    if (semver.lt(coreVersion, this.params.pioCoreMinVersion)) {
      this.params.setUseBuiltinPIOCore(true);
      this.params.useBuiltinPIOCore = true;
      this.params.useDevelopmentPIOCore = this.params.useDevelopmentPIOCore || semver.prerelease(this.params.pioCoreMinVersion);
      throw new Error(`Incompatible PIO Core ${coreVersion}`);
    }

    this.status = BaseStage.STATUS_SUCCESSED;
    console.info(`Found PIO Core ${coreVersion}`);
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
      await this.createVirtualenv();
      await this.installPIOCore();
      await this.installPIOHome();
    } catch (err) {
      misc.reportError(err);
      throw err;
    }

    this.status = BaseStage.STATUS_SUCCESSED;
    return true;
  }

}
