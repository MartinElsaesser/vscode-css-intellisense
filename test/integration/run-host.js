const path = require('path');
const { spawnSync } = require('child_process');
const {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} = require('@vscode/test-electron');

const LANGUAGE_EXTENSIONS = ['vue.volar', 'svelte.svelte-vscode'];

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, 'out/suite/index.js');
  const workspacePath = path.resolve(__dirname, 'fixtures/workspace');
  const cachePath = process.env.VSCODE_TEST_CACHE;
  const extensionsDir =
    process.env.VSCODE_EXTENSIONS_DIR ||
    path.resolve(extensionDevelopmentPath, '.vscode-test/extensions');

  const vscodeExecutablePath = await downloadAndUnzipVSCode(cachePath ? { cachePath } : {});
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
  for (const id of LANGUAGE_EXTENSIONS) {
    const result = spawnSync(
      cli,
      [...cliArgs, '--extensions-dir', extensionsDir, '--install-extension', id],
      { stdio: 'inherit', shell: process.platform === 'win32' }
    );
    if (result.status !== 0) {
      console.warn(`warning: could not install ${id}; language integration tests may fail`);
    }
  }

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      workspacePath,
      '--extensions-dir',
      extensionsDir,
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
