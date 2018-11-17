/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

const packageConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

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
  externals: Object.keys(packageConfig.dependencies).filter(key => key !== 'ws'),
  module: {
    rules: [
      {
        test: /\.js$/,
        loader: 'babel-loader',
        exclude: /(node_modules|bower_components|public)/
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      PACKAGE_VERSION: JSON.stringify(packageConfig.version)
    }),
  ],
  resolve: {
    modules: [path.resolve('./node_modules'), path.resolve('./src')],
    extensions: ['.json', '.js']
  }
};
