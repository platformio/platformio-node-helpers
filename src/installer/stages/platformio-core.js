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
  static PENV_LOCK_FILE_NAME = 'piopenv.lock';
  static PENV_LOCK_VERSION = 1; // only integer is valid

  static pythonVersion = '3.7.4';
  static getPipUrl = 'https://bootstrap.pypa.io/get-pip.py';
  static virtualenvUrl =
    'https://files.pythonhosted.org/packages/66/f0/6867af06d2e2f511e4e1d7094ff663acdebc4f15d4a0cb0fed1007395124/virtualenv-16.7.5.tar.gz';
  static pioCoreDevelopUrl =
    'https://github.com/platformio/platformio/archive/develop.zip';

  constructor() {
    super(...arguments);
    tmp.setGracefulCleanup();

    this._skipPIPInstalling = false;
  }

  get name() {
    return 'PlatformIO Core';
  }

  async whereIsPython() {
    let status = this.params.pythonPrompt.STATUS_TRY_AGAIN;
    do {
      const pythonExecutable = await misc.getPythonExecutable(
        this.params.useBuiltinPIOCore
      );
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
    throw new Error(
      'Can not find Python Interpreter. Please install Python 3.5 or above manually'
    );
  }

  async installPythonForWindows() {
    // https://www.python.org/ftp/python/3.7.4/python-3.7.4.exe
    // https://www.python.org/ftp/python/3.7.4/python-3.7.4-amd64.exe
    const pythonArch = process.arch === 'x64' ? '-amd64' : '';
    const installerUrl = `https://www.python.org/ftp/python/${PlatformIOCoreStage.pythonVersion}/python-${PlatformIOCoreStage.pythonVersion}${pythonArch}.exe`;
    const installer = await helpers.download(
      installerUrl,
      path.join(core.getCacheDir(), path.basename(installerUrl))
    );
    const targetDir = path.join(core.getCoreDir(), 'python37');
    let pythonPath = path.join(targetDir, 'python.exe');

    if (!fs.isFileSync(pythonPath)) {
      pythonPath = await this.installPythonFromWindowsInstaller(installer, targetDir);
      this._skipPIPInstalling = true;
    }

    // append temporary to system environment
    process.env.PATH = [
      targetDir,
      path.join(targetDir, 'Scripts'),
      process.env.PATH
    ].join(path.delimiter);
    process.env.Path = process.env.PATH;
    return pythonPath;
  }

  installPythonFromWindowsInstaller(installer, targetDir) {
    if (fs.isDirectorySync(targetDir)) {
      try {
        fs.removeSync(targetDir);
      } catch (err) {
        console.warn(err);
      }
    }
    const logPath = path.join(core.getCacheDir(), 'python-installer.log');
    return new Promise((resolve, reject) => {
      misc.runCommand(
        installer,
        [
          '/quiet',
          '/log',
          logPath,
          'SimpleInstall=1',
          'InstallAllUsers=0',
          'InstallLauncherAllUsers=0',
          'Shortcuts=0',
          'Include_lib=1',
          'Include_pip=1',
          'Include_doc=0',
          'Include_launcher=0',
          'Include_test=0',
          'Include_tcltk=0',
          `TargetDir=${targetDir}`,
          `DefaultAllUsersTargetDir=${targetDir}`,
          `DefaultJustForMeTargetDir=${targetDir}`
        ],
        code => {
          if (code === 0 && fs.isFileSync(path.join(targetDir, 'python.exe'))) {
            return resolve(path.join(targetDir, 'python.exe'));
          }
          if (fs.isFileSync(logPath)) {
            console.error(fs.readFileSync(logPath).toString());
          }
          return reject(
            new Error(
              'Could not install Python 3 automatically. Please install it manually from https://python.org'
            )
          );
        },
        {
          spawnOptions: {
            shell: true
          }
        }
      );
    });
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
    this.cleanVirtualEnvDir();
    const pythonExecutable = await this.whereIsPython();
    const venvCmdOptions = [
      [pythonExecutable, '-m', 'venv', core.getEnvDir()],
      [pythonExecutable, '-m', 'virtualenv', '-p', pythonExecutable, core.getEnvDir()],
      ['virtualenv', '-p', pythonExecutable, core.getEnvDir()],
      [pythonExecutable, '-m', 'virtualenv', core.getEnvDir()],
      ['virtualenv', core.getEnvDir()]
    ];
    let lastError = null;
    for (const cmdOptions of venvCmdOptions) {
      this.cleanVirtualEnvDir();
      try {
        return await new Promise((resolve, reject) => {
          misc.runCommand(
            cmdOptions[0],
            cmdOptions.slice(1),
            (code, stdout, stderr) => {
              return code === 0
                ? resolve(stdout)
                : reject(new Error(`User's Virtualenv: ${stderr}`));
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
    const virtualenvScript = fs
      .listTreeSync(dstDir)
      .find(item => path.basename(item) === 'virtualenv.py');
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
          throw new Error(
            `Could not create PIO Core Virtual Environment. Please create it manually -> http://bit.ly/pio-core-virtualenv \n ${errDl.toString()}`
          );
        }
      }
    }
  }

  async installPIP(pythonExecutable) {
    fs.writeFileSync(
      path.join(core.getEnvDir(), 'pip.conf'),
      ['[global]', 'user=no'].join('\n')
    );
    if (this._skipPIPInstalling) {
      return;
    }
    // we use manual downloading to resolve SSL issue with old `pip`
    const getPipScript = await helpers.download(
      PlatformIOCoreStage.getPipUrl,
      path.join(core.getCacheDir(), path.basename(PlatformIOCoreStage.getPipUrl))
    );
    return new Promise((resolve, reject) => {
      misc.runCommand(pythonExecutable, [getPipScript], (code, stdout, stderr) => {
        return code === 0 ? resolve(stdout) : reject(stderr);
      });
    });
  }

  async installPIOCore() {
    const pythonExecutable = await this.whereIsPython();

    // Try to upgrade PIP to the latest version with updated openSSL
    try {
      await this.installPIP(pythonExecutable);
    } catch (err) {
      console.warn(err);
      misc.reportError(new Error(`Installing PIP: ${err.toString()}`));
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
    if (!state || !state.pioCoreChecked || !state.lastIDEVersion) {
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
      (process.env.PLATFORMIO_IDE &&
        newState.lastIDEVersion &&
        newState.lastIDEVersion !== process.env.PLATFORMIO_IDE) ||
      now - PlatformIOCoreStage.UPGRADE_PIOCORE_TIMEOUT >
        parseInt(newState.pioCoreChecked)
    ) {
      newState.pioCoreChecked = now;
      // PIO Core
      await new Promise(resolve => {
        core.runPIOCommand(
          [
            'upgrade',
            ...(this.params.useDevelopmentPIOCore &&
            !semver.prerelease(currentCoreVersion)
              ? ['--dev']
              : [])
          ],
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

  checkPenvLocked() {
    const lockPath = path.join(
      core.getEnvDir(),
      PlatformIOCoreStage.PENV_LOCK_FILE_NAME
    );
    if (!fs.isFileSync(lockPath)) {
      throw new Error('Virtual environment lock file is missed');
    }
    if (parseInt(fs.readFileSync(lockPath)) !== PlatformIOCoreStage.PENV_LOCK_VERSION) {
      throw new Error('Virtual environment is outdated');
    }
    return true;
  }

  lockPenvDir() {
    fs.writeFileSync(
      path.join(core.getEnvDir(), PlatformIOCoreStage.PENV_LOCK_FILE_NAME),
      PlatformIOCoreStage.PENV_LOCK_VERSION.toString()
    );
  }

  async check() {
    const coreVersion = helpers.PEPverToSemver(await core.getVersion());

    if (this.params.useBuiltinPIOCore) {
      if (!fs.isDirectorySync(core.getEnvBinDir())) {
        throw new Error('Virtual environment is not created');
      }
      // this.checkPenvLocked();
      try {
        await this.autoUpgradePIOCore(coreVersion);
      } catch (err) {
        console.warn(err);
      }
    }

    if (semver.lt(coreVersion, this.params.pioCoreMinVersion)) {
      this.params.setUseBuiltinPIOCore(true);
      this.params.useBuiltinPIOCore = true;
      this.params.useDevelopmentPIOCore =
        this.params.useDevelopmentPIOCore ||
        semver.prerelease(this.params.pioCoreMinVersion);
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
      this.lockPenvDir();

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
