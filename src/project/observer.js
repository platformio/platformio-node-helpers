/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as core from '../core';
import * as proc from '../proc';

import ProjectConfig from './config';
import ProjectIndexer from './indexer';
import { ProjectTasks } from './tasks';
import { disposeSubscriptions } from '../misc';
import path from 'path';

export default class ProjectObserver {
  static WATCH_DIRS_UPDATE_DELAY = 10000; // 10 seconds

  constructor(projectDir, options) {
    this.projectDir = projectDir;
    this.options = options;

    this.subscriptions = [];
    this.dirWatchSubscriptions = [];

    this._cache = new Map();
    this._indexer = undefined;
    this._projectTasks = new ProjectTasks(this.projectDir, this.options.ide);
    this._updateDirWatchersTimeout = undefined;
    this._activeEnvName = undefined;

    if (this.getSetting('autoRebuild')) {
      this.setupFSWatchers();
    }
  }

  dispose() {
    disposeSubscriptions(this.dirWatchSubscriptions);
    disposeSubscriptions(this.subscriptions);
    if (this._updateDirWatchersTimeout) {
      clearTimeout(this._updateDirWatchersTimeout);
    }
  }

  activate() {
    console.info('Activating project', this.projectDir);
    if (!this._indexer && this.getSetting('autoRebuild')) {
      this.getIndexer().rebuild();
    }
  }

  deactivate() {
    console.info('Deactivating project', this.projectDir);
  }

  getSetting(name) {
    return (this.options.settings || {})[name];
  }

  resetCache() {
    this._cache.clear();
  }

  get activeEnvName() {
    return this._activeEnvName;
  }

  set activeEnvName(activeEnvName) {
    this._activeEnvName = activeEnvName;
  }

  async getProjectEnvs() {
    if (this._cache.has('projectEnvs')) {
      return this._cache.get('projectEnvs');
    }
    const result = [];
    const prevCWD = process.cwd();
    process.chdir(this.projectDir);
    try {
      const config = new ProjectConfig();
      await config.read(path.join(this.projectDir, 'platformio.ini'));
      for (const name of config.envs()) {
        const platform = config.get(`env:${name}`, 'platform');
        if (!platform) {
          continue;
        }
        result.push({ name, platform });
      }
    } catch (err) {
      console.warn(
        `Could not parse "platformio.ini" file in ${this.projectDir}: ${err}`
      );
    }
    // restore original CWD
    process.chdir(prevCWD);
    this._cache.set('projectEnvs', result);
    return result;
  }

  async getDefaultTasks() {
    return this._projectTasks.getDefaultTasks();
  }

  async getLoadedEnvTasks(name, options = { preload: false }) {
    const cacheKey = `envTasks${name}`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }
    const lazyLoading =
      options.preload ||
      this.getSetting('autoPreloadEnvTasks') ||
      this.activeEnvName === name ||
      (await this.getProjectEnvs()).length === 1;
    if (!lazyLoading) {
      return undefined;
    }
    return await this.loadEnvTasks(name);
  }

  async loadEnvTasks(name) {
    const cacheKey = `envTasks${name}`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }
    this._cache.set(cacheKey, []); // avoid multiple loadings...
    this._cache.set(
      cacheKey,
      await this.options.api.withTasksLoadingProgress(
        async () => await this._projectTasks.fetchEnvTasks(name)
      )
    );
    return this._cache.get(cacheKey);
  }

  getIndexer() {
    if (!this._indexer) {
      this._indexer = new ProjectIndexer(this.projectDir, this.options, this);
    }
    return this._indexer;
  }

  rebuildIndex() {
    return this.getIndexer().rebuild();
  }

  onDidChangeProjectConfig() {
    this.resetCache();
    if ((this.options.api || {}).onDidChangeProjectConfig) {
      this.options.api.onDidChangeProjectConfig(this.projectDir);
    }
    this.getIndexer().requestRebuild();
    this.requestUpdateDirWatchers();
  }

  onDidChangeLibDirs() {
    this.getIndexer().requestRebuild();
  }

  setupFSWatchers() {
    const watcher = this.options.api.createFileSystemWatcher(
      path.join(this.projectDir, 'platformio.ini')
    );
    this.subscriptions.push(
      watcher,
      watcher.onDidCreate(() => this.onDidChangeProjectConfig()),
      watcher.onDidChange(() => this.onDidChangeProjectConfig())
      // watcher.onDidDelete(() => undefined)
    );
    this.requestUpdateDirWatchers();
  }

  requestUpdateDirWatchers() {
    if (this._updateDirWatchersTimeout) {
      clearTimeout(this._updateDirWatchersTimeout);
    }
    this._updateDirWatchersTimeout = setTimeout(
      this.updateDirWatchers.bind(this),
      ProjectObserver.WATCH_DIRS_UPDATE_DELAY
    );
  }

  async updateDirWatchers() {
    disposeSubscriptions(this.dirWatchSubscriptions);
    try {
      (await this.fetchLibDirs()).forEach((dir) => {
        const watcher = this.options.api.createDirSystemWatcher(dir);
        this.dirWatchSubscriptions.push(
          watcher,
          watcher.onDidCreate(() => this.onDidChangeLibDirs()),
          watcher.onDidChange(() => this.onDidChangeLibDirs()),
          watcher.onDidDelete(() => this.onDidChangeLibDirs())
        );
      });
    } catch (err) {
      console.warn(err);
    }
  }

  async fetchLibDirs() {
    const scriptLines = [
      'import json, os',
      'from platformio.project.config import ProjectConfig',
      'c = ProjectConfig()',
      'libdeps_dir = c.get_optional_dir("libdeps")',
      'watch_dirs = [c.get_optional_dir("globallib"), c.get_optional_dir("lib"), libdeps_dir]',
      'watch_dirs.extend(os.path.join(libdeps_dir, d) for d in (os.listdir(libdeps_dir) if os.path.isdir(libdeps_dir) else []) if os.path.isdir(os.path.join(libdeps_dir, d)))',
      'print(json.dumps(watch_dirs))',
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
    return JSON.parse(output.trim());
  }
}
