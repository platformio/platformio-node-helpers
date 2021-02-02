/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import { runPIOCommand } from '../core';

export default class ProjectIndexer {
  static AUTO_REBUILD_DELAY = 3000;

  constructor(projectDir, options, observer) {
    this.projectDir = projectDir;
    this.options = options;
    this.observer = observer;

    this._rebuildTimeout = undefined;
    this._inProgress = false;
  }

  dispose() {
    if (this._rebuildTimeout) {
      clearTimeout(this._rebuildTimeout);
    }
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
    if (this._inProgress) {
      return;
    }
    return this.options.api.withWindowProgress(async () => {
      this._inProgress = true;
      try {
        await new Promise((resolve, reject) => {
          const args = ['init', '--ide', this.options.ide];
          if (this.observer.activeEnvName) {
            args.push('--environment', this.observer.activeEnvName);
          }
          runPIOCommand(
            args,
            (code, stdout, stderr) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(stderr));
              }
            },
            {
              spawnOptions: {
                cwd: this.projectDir,
              },
              runInQueue: true,
            }
          );
        });
      } catch (err) {
        console.warn(err);
      }
      this._inProgress = false;
    }, 'PlatformIO: Rebuilding IntelliSense Index');
  }
}
