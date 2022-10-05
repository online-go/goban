[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

# Current state

*Warning* This code base has been extracted from the online-go.com source code
where it was highly integrated and minimally touched for many years even during
some moderinization of the rest of the site. Until v 1.0 is released of this
library, it is not recommended to make use of it as much overhaul is happening
to improve usability on sites other than online-go.com.


# Dev setup

## 1. Using local clone of `goban`

If You want to use Your local clone of the `goban` repo in ogs ui, You need to link the repo to `npm`.
```
# need to run the command from the ui dir:
$ cd online-go.com
$ sudo npm link ../goban
```

If you wanna unlink later (to go back to the default version), you can run:
```
$ sudo npm unlink goban
```

## 2. Building `goban`
You need to compile goban: 

```
$ cd goban

# dependencies (your mileage may vary based on what you have, or have not installed already)
$ sudo npm install --global yarn
$ yarn add webpack-cli --dev

# build the goban module
$ make
```
## 3. Run local copy of `ui` with `goban`

```
$ cd online-go.com

# check the goban module
$ ls -l node_modules/goban
lrwxrwxrwx 1 root root 11 Oct  4 13:10 node_modules/goban -> ../../goban

# run the ui
$ make
```


# Running & Writing tests
Is easy.

## Deps
Just install `jest` package (might need `sudo`):

```
$ npm install --save-dev jest
```

## Running and writing tests
Tests live in `src/__tests__` directory, check it out & add Your own!
To run tests:
```
# from root directory
$ cd goban 
$ npm test
```

