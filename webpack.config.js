'use strict';

var path = require('path');
let fs = require('fs');
var webpack = require('webpack');
const pkg = require('./package.json');

const production = process.env.PRODUCTION ? true : false;


let plugins = [];

plugins.push(new webpack.BannerPlugin(
`Copyright (C) 2012-2019  Online-Go.com

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`));

let defines = {
    PRODUCTION: production,
    CLIENT: true,
    SERVER: false,
};

plugins.push(new webpack.DefinePlugin(defines));

module.exports = {
    mode: production ? 'production' : 'development',
    entry: {
        'index': './src/index.ts',
        'engine': './src/engine.ts',
    },
    resolve: {
        modules: [
            'src',
            'node_modules'
        ],
        extensions: [".webpack.js", ".web.js", ".ts", ".tsx", ".js"],
    },
    output: {
        path: __dirname + '/lib',
        filename: production ? '[name].min.js' : '[name].js'
    },
    module: {
        rules: [
            // All files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'.
            {
                test: /\.tsx?$/,
                loader: "ts-loader",
                exclude: /node_modules/,
            }
        ]
    },

    performance: {
        maxAssetSize: 1024 * 1024 * 2.5,
        maxEntrypointSize: 1024 * 1024 * 2.5,
    },

    externals: {
        "pixi.js": "PIXI", // can't seem to import anyways
    },

    plugins: plugins,

    devtool: 'source-map',

    devServer: {
        contentBase: [
            path.join(__dirname, 'test'),
            path.join(__dirname, 'lib'),
        ],
        index: 'index.html',
        compress: true,
        port: 9000
    }
};
