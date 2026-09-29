const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('node:path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
// Keep release bundling within the Windows build host's process/memory budget.
const backendRoot = path.resolve(__dirname, 'backend').replace(/\\/g, '[/\\\\]');
const config = {
  maxWorkers: 2,
  resolver: {
    blockList: [new RegExp(`^${backendRoot}[/\\\\]`)],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
