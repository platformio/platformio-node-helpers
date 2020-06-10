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
  static genericTasks = [
    {
      name: 'Build',
      args: ['run'],
      multienv: true
    },
    {
      name: 'Upload',
      args: ['run', '--target', 'upload'],
      multienv: true
    },
    {
      name: 'Monitor',
      args: ['device', 'monitor'],
      multienv: true
    },
    {
      name: 'Upload and Monitor',
      args: ['run', '--target', 'upload', '--target', 'monitor'],
      multienv: true
    },
    {
      name: 'Devices',
      args: ['device', 'list']
    },
    {
      name: 'Clean',
      args: ['run', '--target', 'clean'],
      multienv: true
    },
    {
      name: 'Test',
      args: ['test'],
      group: 'Advanced',
      multienv: true
    },
    {
      name: 'Check',
      args: ['check'],
      group: 'Advanced',
      multienv: true
    },
    {
      name: 'Pre-Debug',
      description: 'Build in debug mode',
      args: ['debug'],
      group: 'Advanced',
      multienv: true
    },
    {
      name: 'Verbose Build',
      args: ['run', '--verbose'],
      group: 'Advanced',
      multienv: true
    },
    {
      name: 'Verbose Upload',
      args: ['run', '--verbose', '--target', 'upload'],
      group: 'Advanced',
      multienv: true
    },
    {
      name: 'Remote Upload',
      args: ['remote', 'run', '--target', 'upload'],
      group: 'PIO Remote',
      multienv: true
    },
    {
      name: 'Remote Monitor',
      args: ['remote', 'device', 'monitor'],
      group: 'PIO Remote'
    },
    {
      name: 'Remote Devices',
      args: ['remote', 'device', 'list'],
      group: 'PIO Remote'
    },
    {
      name: 'Remote Test',
      args: ['remote', 'test'],
      group: 'PIO Remote',
      multienv: true
    }
  ];

  constructor(projectDir, ide) {
    this.projectDir = projectDir;
    this.ide = ide;
  }

  async getGenericTasks() {
    // Generic tasks
    const result = ProjectTasks.genericTasks.map(
      task => new TaskItem(task.name, task.description, task.args.slice(0), task.group)
    );
    // Miscellaneous tasks
    result.push(
      new TaskItem(
        'Rebuild IntelliSense Index',
        undefined,
        ['init', '--ide', this.ide],
        'Miscellaneous'
      ),
      new TaskItem(
        'Update Project Libraries',
        undefined,
        ['lib', 'update'],
        'Miscellaneous'
      ),
      new TaskItem(
        'Update All',
        'Update All (libraries, dev-platforms, and packages)',
        ['update'],
        'Miscellaneous'
      ),
      new TaskItem('Upgrade PlatformIO Core', undefined, ['upgrade'], 'Miscellaneous')
    );
    return result;
  }

  async fetchEnvTasks(name) {
    const result = [];
    const usedTitles = [];
    for (const task of ProjectTasks.genericTasks) {
      if (!task.multienv) {
        continue;
      }
      usedTitles.push(task.name);
      result.push(
        new TaskItem(
          task.name,
          task.description,
          [...task.args.slice(0), '--environment', name],
          task.group
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
            target.group
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
      'from platformio.project.helpers import load_project_ide_data',
      `print(json.dumps(load_project_ide_data(os.getcwd(), '${name}')["targets"]))`
    ];
    const output = await proc.getCommandOutput(
      await core.getCorePythonExe(),
      ['-c', scriptLines.join(';')],
      {
        spawnOptions: {
          cwd: this.projectDir
        }
      }
    );
    return JSON.parse(output.trim());
  }
}

export class TaskItem {
  constructor(name, description, args, group = 'Generic') {
    this.name = name;
    this.description = description;
    this.args = args;
    this.group = group;
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
    let id = this.name;
    if (this.coreEnv) {
      id += ` (${this.coreEnv})`;
    }
    return id;
  }

  get title() {
    return this.description ? `${this.id} [${this.description}]` : this.id;
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
