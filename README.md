[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

# Current state

_Warning_ This code base has been extracted from the online-go.com source code
where it was highly integrated and minimally touched for many years even during
some moderinization of the rest of the site. Until v 1.0 is released of this
library, it is not recommended to make use of it as much overhaul is happening
to improve usability on sites other than online-go.com.

# Usage:

To import into an application targeting the web:

```
import { ... } from "goban";
```

To import into an application targeting node:

```
import { ... } from "goban/lib/engine";
```

# Documentation

https://docs.online-go.com/goban/

# Dev setup

## 1. Building `goban`

If you have `make` installed you can simply run

```
make
```

Or, you can build and run manually using

```
yarn install
yarn run dev
```

(`yarn install` is only necessary the first time you start working on the project,
or whenever dependencies are updated)

## 2. Using local clone of `goban` while working on online-go.com

From your `goban` directory run

`yarn link`

From the `online-go.com` directory run

`yarn link goban`

Once done, your online-go.com development environment will use your development
`goban` code.

# Before PR

Be ready for CI check on PR:

-   run tests `npm test`
-   run prettify `npm run prettier`

[Optional] You can also set up a pre-commit to run checks locally before you commit:

```
npx husky install
```

# Running & Writing tests

Tests live in `src/__tests__` directory, check it out & add Your own!
To run tests:

```
npm test
```
