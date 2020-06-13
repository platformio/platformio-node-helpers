/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as core from '../core';
import * as misc from '../misc';
import * as proc from '../proc';

import fs from 'fs';
import path from 'path';
import { runPIOCommand } from '../core';

export default class ProjectIndexer {
  static AUTO_REBUILD_DELAY = 3000;

  static isPIOProjectSync(projectDir) {
    try {
      fs.accessSync(path.join(projectDir, 'platformio.ini'));
      return true;
    } catch (err) {}
    return false;
  }

  constructor(projectDir, options) {
    this.projectDir = projectDir;
    this.options = options;
    this.subscriptions = [];
    this.dirWatchSubscriptions = [];

    this._rebuildTimeout = undefined;
    this._updateDirWatchersTimeout = undefined;
    this._inProgress = false;

    this.setupWatchers();
  }

  requestRebuild() {
    if (this._rebuildTimeout) {
      clearTimeout(this._rebuildTimeout);
    }
    this._rebuildTimeout = setTimeout(
      this.rebuild.bind(this),
      ProjectIndexer.AUTO_REBUILD_DELAY
    );
  }

  rebuild(envName) {
    if (this._inProgress || !ProjectIndexer.isPIOProjectSync(this.projectDir)) {
      return;
    }
    return this.options.withProgress(async () => {
      this._inProgress = true;
      try {
        await new Promise((resolve, reject) => {
          const args = [
            'init',
            '--ide',
            this.options.ide,
            '--project-dir',
            this.projectDir,
          ];
          if (envName) {
            args.push('--environment', envName);
          }
          runPIOCommand(args, (code, stdout, stderr) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(stderr));
            }
          });
        });
      } catch (err) {
        console.warn(err);
      }
      this._inProgress = false;
    });
  }

  setupWatchers() {
    const watcher = this.options.createFileSystemWatcher(
      path.join(this.projectDir, 'platformio.ini')
    );
    this.subscriptions.push(
      watcher,
      watcher.onDidCreate(() => {
        this.requestRebuild();
        this.requestUpdateDirWatchers();
      }),
      watcher.onDidChange(() => {
        this.requestRebuild();
        this.requestUpdateDirWatchers();
      }),
      watcher.onDidDelete(() => this.updateDirWatchers())
    );
    this.requestUpdateDirWatchers();
  }

  requestUpdateDirWatchers() {
    if (this._updateDirWatchersTimeout) {
      clearTimeout(this._updateDirWatchersTimeout);
    }
    this._updateDirWatchersTimeout = setTimeout(
      this.updateDirWatchers.bind(this),
      ProjectIndexer.AUTO_REBUILD_DELAY * 3
    );
  }

  async updateDirWatchers() {
    misc.disposeSubscriptions(this.dirWatchSubscriptions);
    if (!ProjectIndexer.isPIOProjectSync(this.projectDir)) {
      return;
    }
    try {
      (await this.fetchWatchDirs()).forEach((dir) => {
        const watcher = this.options.createDirSystemWatcher(dir);
        this.dirWatchSubscriptions.push(
          watcher,
          watcher.onDidCreate(() => this.requestRebuild()),
          watcher.onDidChange(() => this.requestRebuild()),
          watcher.onDidDelete(() => this.requestRebuild())
        );
      });
    } catch (err) {
      console.warn(err);
    }
  }

  async fetchWatchDirs() {
    const scriptLines = [
      'import os',
      'from platformio.project.config import ProjectConfig',
      'c = ProjectConfig()',
      'libdeps_dir = c.get_optional_dir("libdeps")',
      'watch_dirs = [c.get_optional_dir("globallib"), c.get_optional_dir("lib"), libdeps_dir]',
      'watch_dirs.extend(os.path.join(libdeps_dir, d) for d in (os.listdir(libdeps_dir) if os.path.isdir(libdeps_dir) else []) if os.path.isdir(os.path.join(libdeps_dir, d)))',
      'print(":".join(watch_dirs))',
    ];
    const output = await proc.getCommandOutput(
      await core.getCorePythonExe(),
      ['-c', scriptLines.join(';')],
      {
        spawnOptions: {
          cwd: this.projectDir,
        },
      }
    );
    return output.trim().split(':');
  }

  dispose() {
    misc.disposeSubscriptions(this.dirWatchSubscriptions);
    misc.disposeSubscriptions(this.subscriptions);
    if (this._rebuildTimeout) {
      clearTimeout(this._rebuildTimeout);
    }
    if (this._updateDirWatchersTimeout) {
      clearTimeout(this._updateDirWatchersTimeout);
    }
  }
}
