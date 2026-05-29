const path = require('path');
const Mocha = require('mocha');
const fs = require('fs');

function getTestFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      // Skip suite directory to avoid self-loading
      if (path.basename(file) === 'suite') return;
      results = results.concat(getTestFiles(file));
    } else if (file.endsWith('.test.js')) {
      results.push(file);
    }
  });
  return results;
}

function run() {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true
  });

  const testsRoot = path.resolve(__dirname, '..');

  return new Promise((c, e) => {
    try {
      const files = getTestFiles(testsRoot);
      console.log(`Found test files: \n${files.map(f => ` - ${path.basename(f)}`).join('\n')}`);
      files.forEach(f => mocha.addFile(f));

      mocha.run(failures => {
        if (failures > 0) {
          e(new Error(`${failures} tests failed.`));
        } else {
          c();
        }
      });
    } catch (err) {
      e(err);
    }
  });
}

module.exports = {
  run
};
