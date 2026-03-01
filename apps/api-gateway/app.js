'use strict'

const path = require('path')
const AutoLoad = require('@fastify/autoload')

module.exports = function (fastify, opts, done) {
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'routes'),
    options: Object.assign({}, opts)
  })
  done()
}
