'use strict';

module.exports = require('eslint-config-sukka').sukka({
  ignores: {
    customGlobs: ['worker-configuration.d.ts']
  },
  ts: {
    allowDefaultProject: []
  }
});
