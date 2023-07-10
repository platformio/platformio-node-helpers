/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as core from '../core';

export class ProjectTasks {
  static generalTasks = [
    {
      name: 'Build',
      args: ['run'],
      multienv: true,
    },
    {
      name: 'Upload',
      args: ['run', '--target', 'upload'],
      optionalArgs: ['--upload-port'],
      multienv: true,
    },
    {
      name: 'Monitor',
      args: ['device', 'monitor'],
      optionalArgs: ['--port'],
      multienv: true,
    },
    {
      name: 'Upload and Monitor',
      args: ['run', '--target', 'upload', '--target', 'monitor'],
      optionalArgs: ['--upload-port', '--monitor-port'],
      multienv: true,
    },
    {
      name: 'Devices',
      args: ['device', 'list'],
    },
    {
      name: 'Clean',
      args: ['run', '--target', 'clean'],
      multienv: true,
    },
    {
      name: 'Full Clean',
      description: 'Clean a build environment and installed library dependencies',
      args: ['run', '--target', 'fullclean'],
      multienv: true,
    },
    {
      name: 'List',
      args: ['pkg', 'list'],
      group: 'Dependencies',
      multienv: true,
    },
    {
      name: 'Outdated',
      args: ['pkg', 'outdated'],
      group: 'Dependencies',
      multienv: true,
    },
    {
      name: 'Update',
      args: ['pkg', 'update'],
      group: 'Dependencies',
      multienv: true,
    },
    {
      name: 'Test',
      args: ['test'],
      optionalArgs: ['--upload-port', '--test-port'],
      group: 'Advanced',
      multienv: true,
    },
    {
      name: 'Check',
      args: ['check'],
      group: 'Advanced',
      multienv: true,
    },
    {
      name: 'Pre-Debug',
      description: 'Build in debug mode',
      args: ['debug'],
      group: 'Advanced',
      multienv: true,
    },
    {
      name: 'Verbose Build',
      args: ['run', '--verbose'],
      group: 'Advanced',
      multienv: true,
    },
    {
      name: 'Verbose Upload',
      args: ['run', '--verbose', '--target', 'upload'],
      optionalArgs: ['--upload-port'],
      group: 'Advanced',
      multienv: true,
    },
    {
      name: 'Verbose Test',
      args: ['test', '--verbose'],
      group: 'Advanced',
      multienv: true,
    },
    {
      name: 'Verbose Check',
      args: ['check', '--verbose'],
      group: 'Advanced',
      multienv: true,
    },
    {
      name: 'Compilation Database',
      description: 'Generate compilation database `compile_commands.json`',
      args: ['run', '--target', 'compiledb'],
      group: 'Advanced',
      multienv: true,
    },
    {
      name: 'Remote Upload',
      args: ['remote', 'run', '--target', 'upload'],
      group: 'Remote',
      multienv: true,
    },
    {
      name: 'Remote Monitor',
      args: ['remote', 'device', 'monitor'],
      group: 'Remote',
    },
    {
      name: 'Remote Devices',
      args: ['remote', 'device', 'list'],
      group: 'Remote',
    },
    {
      name: 'Remote Test',
      args: ['remote', 'test'],
      group: 'Remote',
      multienv: true,
    },
    {
      name: 'Upgrade PlatformIO Core',
      args: ['upgrade'],
      group: 'Miscellaneous',
    },
  ];

  constructor(projectDir, ide) {
    this.projectDir = projectDir;
    this.ide = ide;
  }

  async getDefaultTasks() {
    // General tasks
    const result = ProjectTasks.generalTasks.map((task) => {
      const item = new TaskItem(task.name, task.args.slice(0), task.group);
      item.description = task.description;
      item.multienv = !!task.multienv;
      item.optionalArgs = task.optionalArgs;
      return item;
    });
    return result;
  }

  async fetchEnvTasks(name) {
    const result = [];
    const usedTitles = [];
    for (const task of ProjectTasks.generalTasks) {
      if (!task.multienv) {
        continue;
      }
      usedTitles.push(task.name);
      const item = new TaskItem(
        task.name,
        [...task.args.slice(0), '--environment', name],
        task.group
      );
      item.description = task.description;
      item.multienv = true;
      item.optionalArgs = task.optionalArgs;
      result.push(item);
    }

    // Miscellaneous tasks
    const initTask = new TaskItem(
      'Rebuild IntelliSense Index',
      ['project', 'init', '--ide', this.ide, '--environment', name],
      'Miscellaneous'
    );
    initTask.multienv = true;
    result.push(initTask);

    // dev-platform targets
    try {
      for (const target of await this.fetchEnvTargets(name)) {
        if (usedTitles.includes(target.title)) {
          continue;
        }
        const item = new TaskItem(
          target.title || target.name,
          ['run', '--target', target.name, '--environment', name],
          target.group
        );
        item.description = target.description;
        item.multienv = true;
        result.push(item);
      }
    } catch (err) {
      console.error(
        `Could not fetch project targets for '${name}' environment => ${err}`
      );
    }
    return result;
  }

  async fetchEnvTargets(name) {
    const script = `
import json
import os
from platformio.public import load_build_metadata

print(json.dumps(load_build_metadata(os.getcwd(), '${name}', cache=True)["targets"]))
  `;
    const output = await core.getCorePythonCommandOutput(['-c', script], {
      projectDir: this.projectDir,
      runInQueue: true,
    });
    return JSON.parse(output.trim());
  }
}

export class TaskItem {
  constructor(name, args, group = 'General') {
    this.name = name;
    this.args = args;
    this.group = group;
    this.description = undefined;
    this.multienv = false;
    this.optionalArgs = undefined;
  }

  isBuild() {
    return this.name.startsWith('Build');
  }

  isClean() {
    return this.name.startsWith('Clean');
  }

  isTest() {
    return this.name.startsWith('Test');
  }

  get coreTarget() {
    if (this.args[0] !== 'run') {
      return this.args[0];
    }
    const index = this.args.indexOf('--target');
    return index !== -1 ? this.args[index + 1] : 'build';
  }

  get coreEnv() {
    const index = this.args.indexOf('--environment');
    return index !== -1 ? this.args[index + 1] : undefined;
  }

  get id() {
    const env = this.coreEnv;
    return env ? `${this.name} (${env})` : this.name;
  }

  get title() {
    const env = this.coreEnv;
    const title = this.description || this.name;
    return env ? `${title} (${env})` : title;
  }

  getCoreArgs(options = {}) {
    const args = this.args.slice(0);
    if (this.optionalArgs && options.port) {
      this.optionalArgs
        .filter((arg) => arg.endsWith('-port'))
        .forEach((arg) => {
          args.push(arg);
          args.push(options.port);
        });
    }
    return args;
  }
}
