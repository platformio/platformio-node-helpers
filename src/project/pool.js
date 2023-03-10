/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import ProjectObserver from './observer';
import { disposeSubscriptions } from '../misc';

export default class ProjectPool {
  constructor(options) {
    this.options = options || {};
    this._observers = [];
    this._activeProjectDir = undefined;
  }

  getActiveProjectDir() {
    return this._activeProjectDir;
  }

  getActiveObserver() {
    return this._activeProjectDir
      ? this.getObserver(this._activeProjectDir)
      : undefined;
  }

  getObserver(projectDir) {
    if (!projectDir) {
      return undefined;
    }
    let observer = this._observers.find(
      (observer) => observer.projectDir === projectDir
    );
    if (!observer) {
      observer = new ProjectObserver(projectDir, this.options);
      this._observers.push(observer);
    }
    return observer;
  }

  async switch(projectDir) {
    this._activeProjectDir = projectDir;
    console.info('Switching project to', projectDir);
    this._observers
      .filter((observer) => observer.projectDir !== projectDir)
      .forEach((observer) => observer.deactivate());
    const observer = this.getObserver(projectDir);
    await observer.activate();
    return observer;
  }

  dispose() {
    disposeSubscriptions(this._observers);
  }
}
