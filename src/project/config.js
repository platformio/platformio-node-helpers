/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import fs from 'fs';
import glob from 'glob';

export default class ProjectConfig {
  reLines = /[\r\n]+/g;
  reComment = /(^\s*;|\s+;|^\s*#).+/;
  reSection = /^\[([^\]]+)\]/;
  reOptionValue = /^([^=]+)=(.*)/;
  reMultiLineValue = /^\s+(.*)/;
  reInterpolation = /\$\{([^\.\}]+)\.([^\}]+)\}/g;

  static parse_multi_values(items) {
    const result = [];
    if (!items) {
      return result;
    }
    if (typeof items == 'string') {
      items = items.split(items.includes('\n') ? '\n' : ', ');
    }
    for (let item of items) {
      item = item.trim();
      if (item) {
        result.push(item);
      }
    }
    return result;
  }

  constructor(path) {
    this.path = path;
    this._parsed = [];
    this._data = {};
    if (path) {
      this.read(path);
    }
  }

  read(path) {
    if (this._parsed.includes(path)) {
      return;
    }
    this._parsed.push(path);
    let section = null;
    let option = null;
    for (let line of fs.readFileSync(path, 'utf-8').split(this.reLines)) {
      // Remove comments
      line = line.replace(this.reComment, '');
      if (!line) {
        continue;
      }

      // Section
      const mSection = line.match(this.reSection);
      if (mSection) {
        section = mSection[1];
        if (!this._data[section]) {
          this._data[section] = {};
        }
        option = null;
        continue;
      }

      // Option and value
      const mOptionValue = line.match(this.reOptionValue);
      if (section && mOptionValue) {
        option = mOptionValue[1].trim();
        this._data[section][option] = mOptionValue[2].trim();
        continue;
      }

      // Multi-line value
      const mMultiLineValue = line.match(this.reMultiLineValue);
      if (option && mMultiLineValue) {
        this._data[section][option] += '\n' + mMultiLineValue[0];
      }
    }

    this.getlist('platformio', 'extra_configs').forEach(pattern =>
      glob.sync(pattern).forEach(item => this.read(item))
    );
  }

  getraw(section, option) {
    if (!this._data[section]) {
      throw `NoSectionError: ${section}`;
    }
    let value = null;
    if (option in this._data[section]) {
      value = this._data[section][option];
    }
    else {
      if ('extends' in this._data[section]) {
        for (const ext of ProjectConfig.parse_multi_values(this._data[section]['extends'])){
          try {
            value = this.getraw(ext, option);
            break;
          } catch {}
        }
      }
      if (!value && section.startsWith('env:')) {
        try {
          value = this.getraw('env', option);
        } catch {}
      }
    }
    if (!value){
      throw `NoOptionError: ${section} -> ${option}`;
    }
    if (!value.includes('${') || !value.includes('}')) {
      return value;
    }
    return value.replace(this.reInterpolation, (_, section, option) =>
      this._reInterpolationHandler(section, option)
    );
  }

  _reInterpolationHandler(section, option) {
    if (section == 'sysenv') {
      return process.env[option] || '';
    }
    return this.get(section, option);
  }

  sections() {
    return Object.keys(this._data);
  }

  envs() {
    return this.sections()
      .filter(item => item.startsWith('env:'))
      .map(item => item.substring(4));
  }

  get(section, option, default_ = undefined) {
    try {
      return this.getraw(section, option);
    } catch (err) {
      return default_;
    }
  }

  getlist(section, option, default_ = undefined) {
    return ProjectConfig.parse_multi_values(this.get(section, option, default_));
  }
}
