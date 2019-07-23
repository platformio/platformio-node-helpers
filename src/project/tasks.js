/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import ProjectConfig from './config';
import path from 'path';

export class ProjectTasks {

  static baseTasks = [
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
      multienv: true,
      filter: (data) => !data.platform.includes('riscv_gap')
    },
    {
      name: 'Upload using Programmer',
      args: ['run', '--target', 'program'],
      multienv: true,
      filter: (data) => data.platform.includes('atmelavr')
    },
    {
      name: 'Set Fuses',
      args: ['run', '--target', 'fuses'],
      multienv: true,
      filter: (data) => data.platform.includes('atmelavr')
    },
    {
      name: 'Upload and Set Fuses',
      args: ['run', '--target', 'fuses', '--target', 'upload'],
      multienv: true,
      filter: (data) => data.platform.includes('atmelavr')
    },
    {
      name: 'Upload using Programmer and Set Fuses',
      args: ['run', '--target', 'fuses', '--target', 'program'],
      multienv: true,
      filter: (data) => data.platform.includes('atmelavr')
    },
    {
      name: 'Upload File System image',
      args: ['run', '--target', 'uploadfs'],
      multienv: true,
      filter: (data) => data.platform.includes('espressif') || data.platform.includes('riscv_gap')
    },
    {
      name: 'Erase Flash',
      args: ['run', '--target', 'erase'],
      multienv: true,
      filter: (data) => data.platform.includes('espressif') || data.platform.includes('nordicnrf')
    },
    {
      name: 'Devices',
      args: ['device', 'list'],

    },
    {
      name: 'Test',
      args: ['test'],
      multienv: true
    },
    {
      name: 'Pre-Debug',
      description: 'build in debug mode',
      args: ['debug'],
      multienv: true
    },
    {
      name: 'Clean',
      args: ['run', '--target', 'clean'],
      multienv: true
    },
    {
      name: 'Verbose Build',
      args: ['run', '--verbose'],
      multienv: true
    },
    {
      name: 'Verbose Upload',
      args: ['run', '--verbose', '--target', 'upload'],
      multienv: true
    },
    {
      name: 'Remote Upload',
      args: ['remote', 'run', '--target', 'upload'],
      multienv: true
    },
    {
      name: 'Remote Monitor',
      args: ['remote', 'device', 'monitor']
    },
    {
      name: 'Remote Devices',
      args: ['remote', 'device', 'list']
    },
    {
      name: 'Remote Test',
      args: ['remote', 'test'],
      multienv: true
    }
  ];

  constructor(projectDir, ide) {
    this.projectDir = projectDir;
    this.ide = ide;
  }

  async getTasks() {
    if (!this.projectDir) {
      return [];
    }
    const projectEnvs = [];

    const prevCWD = process.cwd();
    process.chdir(this.projectDir);
    try {
      const config = new ProjectConfig(path.join(this.projectDir, 'platformio.ini'));
      for (const env of config.envs()) {
        const platform = config.get(`env:${env}`, 'platform');
        if (!platform) {
          continue;
        }
        projectEnvs.push({
          env,
          platform
        });
      }
    } catch (err) {
      console.warn(`Could not parse "platformio.ini" file in ${this.projectDir}: ${err}`);
      return [];
    }
    // restore original CWD
    process.chdir(prevCWD);

    const result = [];

    // base tasks
    ProjectTasks.baseTasks.forEach(task => {
      if (!task.filter || projectEnvs.some(data => task.filter(data))) {
        result.push(new TaskItem(task.name, task.description, task.args.slice(0)));
      }
    });

    // multi environment tasks
    projectEnvs.forEach(data => {
      ProjectTasks.baseTasks.forEach(task => {
        if (task.multienv && (!task.filter || task.filter(data))) {
          result.push(new TaskItem(task.name, task.description, [...task.args.slice(0), '--environment', data.env]));
        }
      });
    });

    // Misc tasks
    result.push(new TaskItem('Update project libraries', undefined, ['lib', 'update']));
    result.push(new TaskItem('Rebuild IntelliSense Index', undefined, ['init', '--ide', this.ide]));

    return result;
  }
}


export class TaskItem {

  constructor(name, description, args) {
    this.name = name;
    this.description = description;
    this.args = args;
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
