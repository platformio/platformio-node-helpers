/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as core from './core';
import * as home from './home';
import * as misc from './misc';
import * as proc from './proc';

import { ProjectTasks, TaskItem } from './project/tasks';

import BaseStage from './installer/stages/base';
import PlatformIOCoreStage from './installer/stages/platformio-core';
import ProjectConfig from './project/config';
import ProjectPool from './project/pool';

const installer = {
  BaseStage,
  PlatformIOCoreStage,
};

const project = {
  ProjectConfig,
  ProjectPool,
  ProjectTasks,
  TaskItem,
};

export { core, home, installer, misc, proc, project };
