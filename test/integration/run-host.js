const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, 'out/suite/index.js');
  const workspacePath = path.resolve(__dirname, 'fixtures/workspace');
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      workspacePath,
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-workspace-trust',
    ],
  });
}

main().catch((error) => {
  console.error('integration tests failed');
  console.error(error);
  process.exit(1);
});
