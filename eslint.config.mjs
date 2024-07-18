import jsdoc from "eslint-plugin-jsdoc";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-plugin-prettier";
import header from "@tony.ganchev/eslint-plugin-header";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

export default [
    {
        ignores: [
            "**/node_modules",
            "**/dist",
            "**/i18n",
            "**/typings_manual",
            "**/.github",
            "src/third_party",
        ],
    },
    ...compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"),
    {
        plugins: {
            jsdoc,
            "@typescript-eslint": typescriptEslint,
            prettier,
            header,
        },

        languageOptions: {
            globals: {
                ...globals.browser,
            },

            parser: tsParser,
            ecmaVersion: 5,
            sourceType: "module",

            parserOptions: {
                project: "tsconfig.json",
            },
        },

        rules: {
            "@typescript-eslint/ban-types": "off",
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-this-alias": "off",
            "@typescript-eslint/no-unused-vars": "off",
            "@typescript-eslint/no-empty-interface": "off",
            "eqeqeq": ["error", "smart"],
            "no-case-declarations": "off",
            "no-constant-condition": "off",
            "no-empty": "off",
            "no-fallthrough": "off",
            "no-self-assign": "off",
            "@typescript-eslint/no-var-requires": "off",
            "@typescript-eslint/adjacent-overload-signatures": "error",
            "@typescript-eslint/consistent-type-assertions": "error",
            "@typescript-eslint/member-delimiter-style": "error",
            "@typescript-eslint/no-floating-promises": "error",

            "@typescript-eslint/no-inferrable-types": [
                "error",
                {
                    ignoreParameters: true,
                    ignoreProperties: true,
                },
            ],

            "@typescript-eslint/prefer-namespace-keyword": "error",
            "@typescript-eslint/semi": "error",
            "@typescript-eslint/type-annotation-spacing": "error",
            "computed-property-spacing": ["error", "never"],
            "curly": "error",
            "eol-last": "error",

            "id-denylist": [
                "error",
                "any",
                "Number",
                "number",
                "String",
                "string",
                "Boolean",
                "boolean",
                "Undefined",
                "undefined",
            ],

            "id-match": "error",
            "jsdoc/check-alignment": "error",
            "jsdoc/require-asterisk-prefix": "error",
            "linebreak-style": ["error", "unix"],
            "no-caller": "error",
            "no-cond-assign": "error",
            "no-debugger": "error",
            "no-eval": "error",
            "@typescript-eslint/no-invalid-this": "error",

            "no-multiple-empty-lines": [
                "error",
                {
                    max: 3,
                },
            ],

            "no-new-wrappers": "error",
            "no-tabs": "error",
            "no-trailing-spaces": "error",
            "no-undef-init": "error",
            "no-unsafe-finally": "error",
            "no-unused-labels": "error",
            "no-var": "error",
            "one-var": ["error", "never"],

            "prefer-arrow-callback": [
                "error",
                {
                    allowNamedFunctions: true,
                },
            ],

            "prettier/prettier": "error",
            "use-isnan": "error",

            "header/header": [
                "error",
                "block",
                [
                    {
                        pattern: "([Cc]opyright ([(][Cc][)]))|(bin/env)",
                    },
                ],
            ],
        },
    },
    {
        files: ["src/test.tsx", "**/__tests__/*"],

        languageOptions: {
            ecmaVersion: 5,
            sourceType: "script",

            parserOptions: {
                project: null,
            },
        },

        rules: {
            "@typescript-eslint/no-floating-promises": "off",
        },
    },
];
