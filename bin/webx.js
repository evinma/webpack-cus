#! /usr/bin/env node

const path = require('path')
const appPath = process.cwd()
const Compiler = require('../lib/compiler')

const config = require(path.resolve(appPath, 'webpack.config.js'))

let compiler = new Compiler(config)
compiler.run()