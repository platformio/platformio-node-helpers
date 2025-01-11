/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import fs from 'fs';
import path from 'path';
import webpack from 'webpack';

const packageConfig = JSON.parse(fs.readFileSync('./package.json'), 'utf8');

export default {
  mode: 'production',
  entry: './src/index.js',
  output: {
    path: path.resolve('./dist'),
    filename: 'index.js',
    library: 'platformio-node-helpers',
    libraryTarget: 'umd',
    umdNamedDefine: true
  },
  devtool: 'source-map',
  target: 'node',
  externals: Object.keys(packageConfig.dependencies),
  plugins: [
    new webpack.DefinePlugin({
      PACKAGE_VERSION: JSON.stringify(packageConfig.version)
    }),
  ],
  resolve: {
    modules: [path.resolve('./node_modules'), path.resolve('./src')],
    extensions: ['.js']
  }
};
