/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as core from '../core';
import * as proc from '../proc';

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
      multienv: true,
    },
    {
      name: 'Monitor',
      args: ['device', 'monitor'],
      multienv: true,
    },
    {
      name: 'Upload and Monitor',
      args: ['run', '--target', 'upload', '--target', 'monitor'],
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
      name: 'Clean All',
      description: 'Clean a build environment and installed library dependencies',
      args: ['run', '--target', 'cleanall'],
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
      group: 'Remote Development',
      multienv: true,
    },
    {
      name: 'Remote Monitor',
      args: ['remote', 'device', 'monitor'],
      group: 'Remote Development',
    },
    {
      name: 'Remote Devices',
      args: ['remote', 'device', 'list'],
      group: 'Remote Development',
    },
    {
      name: 'Remote Test',
      args: ['remote', 'test'],
      group: 'Remote Development',
      multienv: true,
    },
  ];

  constructor(projectDir, ide) {
    this.projectDir = projectDir;
    this.ide = ide;
  }

  async getDefaultTasks() {
    // General tasks
    const result = ProjectTasks.generalTasks.map(
      (task) =>
        new TaskItem(
          task.name,
          task.description,
          task.args.slice(0),
          task.group,
          task.multienv
        )
    );
    // Miscellaneous tasks
    result.push(
      new TaskItem(
        'Rebuild IntelliSense Index',
        undefined,
        ['project', 'init', '--ide', this.ide],
        'Miscellaneous'
      ),
      new TaskItem('Upgrade PlatformIO Core', undefined, ['upgrade'], 'Miscellaneous')
    );
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
      result.push(
        new TaskItem(
          task.name,
          task.description,
          [...task.args.slice(0), '--environment', name],
          task.group,
          true
        )
      );
    }
    // dev-platform targets
    try {
      for (const target of await this.fetchEnvTargets(name)) {
        if (usedTitles.includes(target.title)) {
          continue;
        }
        result.push(
          new TaskItem(
            target.title || target.name,
            target.description,
            ['run', '--target', target.name, '--environment', name],
            target.group,
            true
          )
        );
      }
    } catch (err) {
      console.error(
        `Could not fetch project targets for '${name}' environment => ${err}`
      );
    }
    return result;
  }

  async fetchEnvTargets(name) {
    const scriptLines = [
      'import json, os',
      'from platformio.public import load_build_metadata',
      `print(json.dumps(load_build_metadata(os.getcwd(), '${name}', cache=True)["targets"]))`,
    ];
    const output = await proc.getCommandOutput(
      await core.getCorePythonExe(),
      ['-c', scriptLines.join(';')],
      {
        spawnOptions: {
          cwd: this.projectDir,
        },
        runInQueue: true,
      }
    );
    return JSON.parse(output.trim());
  }
}

export class TaskItem {
  constructor(name, description, args, group = 'General', multienv = false) {
    this.name = name;
    this.description = description;
    this.args = args;
    this.group = group;
    this.multienv = multienv;
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

  isBuild() {
    return this.name.startsWith('Build');
  }

  isClean() {
    return this.name.startsWith('Clean');
  }

  isTest() {
    return this.name.startsWith('Test');
  }
}
