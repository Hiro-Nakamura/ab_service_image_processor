#!/bin/bash

THISDIR=`dirname "$0"`

# put test/bin in the path so that the mock `convert` command takes priority
export PATH=$THISDIR/bin:$PATH

# linter
$THISDIR/../node_modules/.bin/eslint $THISDIR/../*.js $THISDIR/../src && echo '✔  Your .js files look good.'

# unit tests
$THISDIR/../node_modules/.bin/mocha --reporter dot $THISDIR/bootstrap.test.js $THISDIR/**/*.js
