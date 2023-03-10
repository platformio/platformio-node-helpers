/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as core from '../core';

export default class ProjectConfig {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this._data = undefined;
  }

  async read() {
    const script = `
import json
from platformio.public import ProjectConfig

config = ProjectConfig()
envs = config.envs()

print(json.dumps(dict(
  envs=envs,
  default_envs=config.default_envs(),
  default_env=config.get_default_env(),
  env_platforms={env:config.get(f"env:{env}", "platform", default=None) for env in envs}
)))
`;
    const output = await core.getCorePythonCommandOutput(['-c', script], {
      projectDir: this.projectDir,
    });
    this._data = JSON.parse(output.trim());
  }

  envs() {
    return this._data.envs;
  }

  defaultEnvs() {
    return this._data.default_envs;
  }

  defaultEnv() {
    return this._data.default_env;
  }

  getEnvPlatform(env) {
    return this._data.env_platforms[env];
  }
}
