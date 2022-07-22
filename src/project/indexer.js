/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import path from 'path';
import { runPIOCommand } from '../core';

export default class ProjectIndexer {
  static AUTO_REBUILD_DELAY = 3; // 3 seconds
  static FLOOD_TIME_WINDOW = 60 * 10; // 10 minutes
  static FLOOD_MAX_ATTEMPTS = 30;

  constructor(projectDir, options, observer) {
    this.projectDir = projectDir;
    this.options = options;
    this.observer = observer;

    this._rebuildTimeout = undefined;
    this._inProgress = false;
    this._floodStartedAt = Date.now();
    this._floodAttempts = 0;
  }

  dispose() {
    if (this._rebuildTimeout) {
      clearTimeout(this._rebuildTimeout);
    }
  }

  requestRebuild() {
    if (Date.now() - this._floodStartedAt < ProjectIndexer.FLOOD_TIME_WINDOW * 1000) {
      this._floodAttempts++;
    } else {
      this._floodAttempts = 0;
      this._floodStartedAt = Date.now();
    }
    if (this._rebuildTimeout) {
      clearTimeout(this._rebuildTimeout);
      this._rebuildTimeout = undefined;
    }

    if (this._floodAttempts >= ProjectIndexer.FLOOD_MAX_ATTEMPTS) {
      if (
        this._floodAttempts === ProjectIndexer.FLOOD_MAX_ATTEMPTS &&
        this.options.api.onDidNotifyError
      ) {
        const msg =
          `Multiple requests to rebuild the project "${path.basename(
            this.projectDir
          )}" index have been received!\n` +
          `Automatic index rebuilding process has been terminated for ${
            ProjectIndexer.FLOOD_TIME_WINDOW / 60
          } minutes.`;
        this.options.api.onDidNotifyError(msg, new Error(msg));
      }
      return;
    }

    this._rebuildTimeout = setTimeout(
      this.rebuild.bind(this),
      ProjectIndexer.AUTO_REBUILD_DELAY * 1000
    );
  }

  rebuild() {
    if (this._inProgress) {
      return;
    }
    return this.options.api.withIndexRebuildingProgress(async (withProgress) =>
      this._rebuildWithProgress(withProgress)
    );
  }

  async _rebuildWithProgress(withProgress = undefined) {
    if (!withProgress) {
      withProgress = () => {};
    }
    this._inProgress = true;
    try {
      await new Promise((resolve, reject) => {
        const args = ['project', 'init', '--ide', this.options.ide];
        if (this.observer.getActiveEnvName()) {
          args.push('--environment', this.observer.getActiveEnvName());
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
            onProcStdout: (data) => withProgress(data.toString().trim()),
            onProcStderr: (data) => withProgress(data.toString().trim()),
          }
        );
      });
    } catch (err) {
      console.warn(err);
    }
    this._inProgress = false;
  }
}
