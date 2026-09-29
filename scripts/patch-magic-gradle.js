const fs = require('node:fs');
const path = require('node:path');

const gradleFile = path.join(
  __dirname,
  '..',
  'node_modules',
  '@magiclabs',
  'react-native-device-crypto',
  'android',
  'build.gradle',
);

if (!fs.existsSync(gradleFile)) {
  throw new Error(`Magic Android Gradle file was not found: ${gradleFile}`);
}

const original = fs.readFileSync(gradleFile, 'utf8');
const compatible = original.replace(/^\s*jcenter\(\)\s*\r?\n/gm, '');

if (compatible !== original) {
  fs.writeFileSync(gradleFile, compatible, 'utf8');
  console.log('Removed obsolete jcenter() repositories from Magic Android crypto.');
} else {
  console.log('Magic Android crypto Gradle compatibility is already applied.');
}
