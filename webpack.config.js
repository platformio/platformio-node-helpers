/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

const fs = require('fs');
const path = require('path');

const externals = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).dependencies);
externals.push('path');
externals.push('zlib');

module.exports = {
  mode: 'production',
  entry: __dirname + '/src/index.js',
  output: {
    path: __dirname + '/lib',
    filename: 'index.js',
    library: 'platformio-node-helpers',
    libraryTarget: 'umd',
    umdNamedDefine: true
  },
  target: 'node',
  externals: externals,
  module: {
    rules: [
      {
        test: /\.js$/,
        loader: 'babel-loader',
        exclude: /(node_modules|bower_components|public)/
      }
    ]
  },
  resolve: {
    modules: [path.resolve('./node_modules'), path.resolve('./src')],
    extensions: ['.json', '.js']
  }
};
