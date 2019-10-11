'use strict';

const path = require('path');
const fs = require('fs');
const webpack = require('webpack');
const pkg = require('./package.json');
const TypedocWebpackPlugin = require('typedoc-webpack-plugin');

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


const common = {
    mode: production ? 'production' : 'development',

    resolve: {
        modules: [
            'src',
            'node_modules'
        ],
        extensions: [".webpack.js", ".web.js", ".ts", ".tsx", ".js"],
    },

    performance: {
        maxAssetSize: 1024 * 1024 * 2.5,
        maxEntrypointSize: 1024 * 1024 * 2.5,
    },

    externals: {
        "pixi.js": "PIXI", // can't seem to import anyways
    },

    devtool: 'source-map',
};

module.exports = [
    /* web */
    Object.assign({}, common, {
        'target': 'web',
        entry: {
            'index': './src/index.ts',
            'engine': './src/engine.ts',
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
                    options: {
                        configFile: 'tsconfig.web.json',
                    }
                }
            ]
        },

        plugins: plugins.concat([
            new webpack.DefinePlugin({
                PRODUCTION: production,
                CLIENT: true,
                SERVER: false,
            }),

            new TypedocWebpackPlugin({
                name: 'Goban',
                mode: 'file',
                out: 'doc/',
                theme: 'minimal',
                includeDeclarations: true,
                ignoreCompilerErrors: false,
            })
        ]),

        devServer: {
            contentBase: [
                path.join(__dirname, 'test'),
                path.join(__dirname, 'lib'),
            ],
            index: 'index.html',
            compress: true,
            port: 9000,
            writeToDisk: true,
            hot: false,
            inline: false,
        }
    }),

    /* node */
    Object.assign({}, common, {
        'target': 'node',

        entry: {
            'engine': './src/engine.ts',
        },

        module: {
            rules: [
                // All files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'.
                {
                    test: /\.tsx?$/,
                    loader: "ts-loader",
                    exclude: /node_modules/,
                    options: {
                        configFile: 'tsconfig.node.json',
                    }
                }
            ]
        },

        output: {
            path: __dirname + '/node',
            filename: '[name].js'
        },

        plugins: plugins.concat([
            new webpack.DefinePlugin({
                PRODUCTION: production,
                CLIENT: false,
                SERVER: true,
            }),
        ]),
    })
];
