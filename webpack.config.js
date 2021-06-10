'use strict';

const path = require('path');
const fs = require('fs');
const webpack = require('webpack');
const pkg = require('./package.json');
const TerserPlugin = require('terser-webpack-plugin');

let plugins = [];




plugins.push(new webpack.BannerPlugin(
`Copyright (C) 2012-2020 Online-Go.com

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

module.exports = (env, argv) => {
    const production = argv.mode === 'production';

    plugins.push(new webpack.EnvironmentPlugin({
        NODE_ENV: production ? 'production' : 'development',
        DEBUG: false
    }));

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

        optimization: {
            minimizer: [
            new TerserPlugin({
                terserOptions: {
                },
            }),
            ],
        },


        devtool: 'source-map',
    };


    let ret = [
        /* web */
        Object.assign({}, common, {
            'target': 'web',
            entry: {
                'goban': './src/goban.ts',
                'engine': './src/engine.ts',
                'test': './src/test.tsx',
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
                        exclude: /node_modules/,
                        loader: "ts-loader",
                        options: {
                            configFile: 'tsconfig.json',
                        }
                    }
                ]
            },

            plugins: plugins.concat([
                new webpack.DefinePlugin({
                    CLIENT: true,
                    SERVER: false,
                }),
            ]),

            externals: {
                "react": "React",
                "react-dom": "ReactDOM",
            },

            devServer: {
                contentBase: [
                    path.join(__dirname, 'assets'),
                    path.join(__dirname, 'test'),
                    path.join(__dirname, 'lib'),
                ],
                index: 'index.html',
                compress: true,
                host: '0.0.0.0',
                port: 9000,
                writeToDisk: true,
                disableHostCheck: true,

                hot: false,
                inline: false,
                //inline: true,
            }
        })
    ];

    if (production) {
        ret.push(
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

            externals: {
                "pixi.js": "PIXI",
                "pixi.js-legacy": "PIXI",
            },

            plugins: plugins.concat([
                new webpack.DefinePlugin({
                    CLIENT: false,
                    SERVER: true,
                }),
            ]),

            optimization: {
                minimizer: [
                    new TerserPlugin({
                        terserOptions: {
                          safari10: true,
                        },
                    }),
                ],
            },
        }));
    }

    return ret;
}
