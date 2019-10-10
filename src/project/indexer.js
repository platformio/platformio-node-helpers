/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import {
  disposeSubscriptions,
  getPythonExecutable,
  isPIOProject,
  runCommand
} from '../misc';

import path from 'path';
import { runPIOCommand } from '../core';

export default class ProjectIndexer {
  static AUTO_REBUILD_DELAY = 3000;

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

  rebuild() {
    if (this._inProgress || !isPIOProject(this.projectDir)) {
      return;
    }
    return this.options.withProgress(async () => {
      this._inProgress = true;
      try {
        await new Promise((resolve, reject) => {
          runPIOCommand(
            ['init', '--ide', this.options.ide, '--project-dir', this.projectDir],
            (code, stdout, stderr) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(stderr));
              }
            }
          );
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
    disposeSubscriptions(this.dirWatchSubscriptions);
    if (!isPIOProject(this.projectDir)) {
      return;
    }
    try {
      (await this.fetchWatchDirs()).forEach(dir => {
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
    if (!ProjectIndexer.PythonExecutable) {
      ProjectIndexer.PythonExecutable = await getPythonExecutable(
        this.options.useBuiltinPIOCore
      );
    }
    const scriptLines = [
      'import os',
      'from platformio.project import helpers',
      'libdeps_dir = helpers.get_project_libdeps_dir()',
      'watch_dirs = [helpers.get_project_global_lib_dir(), helpers.get_project_lib_dir(), libdeps_dir]',
      'watch_dirs.extend(os.path.join(libdeps_dir, d) for d in (os.listdir(libdeps_dir) if os.path.isdir(libdeps_dir) else []) if os.path.isdir(os.path.join(libdeps_dir, d)))',
      'print(":".join(watch_dirs))'
    ];
    return new Promise((resolve, reject) => {
      runCommand(
        ProjectIndexer.PythonExecutable,
        ['-c', scriptLines.join(';')],
        (code, stdout, stderr) => {
          if (code === 0) {
            resolve(
              stdout
                .toString()
                .trim()
                .split(':')
            );
          } else {
            reject(new Error(stderr));
          }
        },
        {
          spawnOptions: {
            cwd: this.projectDir
          }
        }
      );
    });
  }

  dispose() {
    disposeSubscriptions(this.dirWatchSubscriptions);
    disposeSubscriptions(this.subscriptions);
    if (this._rebuildTimeout) {
      clearTimeout(this._rebuildTimeout);
    }
    if (this._updateDirWatchersTimeout) {
      clearTimeout(this._updateDirWatchersTimeout);
    }
  }
}
