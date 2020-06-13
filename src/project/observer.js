/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import ProjectIndexer from './indexer';
import { disposeSubscriptions } from '../misc';

export default class ProjectObserver {
  constructor(options) {
    this.options = options;
    this._indexers = [];
  }

  getProjectIndexer(projectDir) {
    return this._indexers.find(item => item.projectDir === projectDir);
  }

  async update(projectDirs) {
    // remove non-existing
    this._indexers = this._indexers.filter(item => {
      if (projectDirs.includes(item.projectDir)) {
        return true;
      }
      item.dispose();
      return false;
    });

    for (const projectDir of projectDirs) {
      if (this._indexers.some(item => item.projectDir === projectDir)) {
        continue;
      }
      const indexer = new ProjectIndexer(projectDir, this.options);
      this._indexers.push(indexer);
      await indexer.rebuild();
    }
  }

  rebuildIndex() {
    this._indexers.forEach(item => item.rebuild());
  }

  dispose() {
    disposeSubscriptions(this._indexers);
  }
}
