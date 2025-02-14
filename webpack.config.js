"use strict";

const path = require("path");
const fs = require("fs");
const webpack = require("webpack");
const pkg = require("./package.json");
const TerserPlugin = require("terser-webpack-plugin");

const DEV_SERVER_PORT = 9000;

let plugins = [];

plugins.push(
    new webpack.BannerPlugin(
        `Copyright (C)  Online-Go.com

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`,
    ),
);

module.exports = (env, argv) => {
    const production = argv.mode === "production";

    plugins.push(
        new webpack.EnvironmentPlugin({
            NODE_ENV: production ? "production" : "development",
            DEBUG: false,
        }),
    );

    const common = {
        mode: production ? "production" : "development",

        resolve: {
            modules: ["src", "node_modules", "src/third_party/goscorer"],
            extensions: [".webpack.js", ".web.js", ".ts", ".tsx", ".js", ".mjs"],
        },

        performance: {
            maxAssetSize: 1024 * 1024 * 2.5,
            maxEntrypointSize: 1024 * 1024 * 2.5,
        },

        optimization: {
            minimizer: [
                new TerserPlugin({
                    terserOptions: {},
                }),
            ],
        },

        devtool: "source-map",
    };

    let ret = [
        // Engine only build for node (no renderers)
        Object.assign({}, common, {
            target: "node",

            entry: {
                "goban-engine": "./src/engine/index.ts",
            },

            module: {
                rules: [
                    // All files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'.
                    {
                        test: /\.tsx?$/,
                        loader: "ts-loader",
                        exclude: /node_modules/,
                        options: {
                            configFile: "tsconfig.node.json",
                        },
                    },
                ],
            },

            output: {
                path: __dirname + "/engine/build",
                filename: "[name].js",
                globalObject: "this",
                library: {
                    name: "goban-engine",
                    type: "umd",
                },
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
        }),

        // With Goban renderers (web)
        Object.assign({}, common, {
            target: "web",
            entry: {
                goban: "./src/index.ts",
                examples: "./examples/main.tsx",
            },

            output: {
                path: __dirname + "/build",
                filename: production ? "[name].min.js" : "[name].js",
                library: {
                    name: "goban",
                    type: "umd",
                },
            },

            module: {
                rules: [
                    // All files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'.
                    {
                        test: /\.tsx?$/,
                        exclude: /node_modules/,
                        loader: "ts-loader",
                        options: {
                            configFile: "tsconfig.json",
                        },
                    },
                    {
                        test: /\.svg$/,
                        loader: "svg-inline-loader",
                    },
                ],
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
                compress: true,
                host: "0.0.0.0",
                port: DEV_SERVER_PORT,
                allowedHosts: ["all"],

                static: [
                    path.join(__dirname, "assets"),
                    path.join(__dirname, "test"),
                    path.join(__dirname, "build"),
                    path.join(__dirname, "examples"),
                    path.join(__dirname, "src"),
                ],
                historyApiFallback: {
                    index: "index.html",
                },
                devMiddleware: {
                    index: true,
                    mimeTypes: { phtml: "text/html" },
                    serverSideRender: true,
                    writeToDisk: true,
                },
                hot: false,
                setupMiddlewares: (middlewares, devServer) => {
                    console.log("------------------");
                    console.log("Demo board is served at http://localhost:" + DEV_SERVER_PORT);

                    console.log("Check your changes there!");
                    console.log("------------------");
                    return middlewares;
                },
            },
        }),
    ];

    return ret;
};
