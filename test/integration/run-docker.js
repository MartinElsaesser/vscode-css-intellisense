const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');

function run(command, args) {
  return spawnSync(command, args, { stdio: 'inherit' });
}

const dockerInfo = spawnSync('docker', ['info'], { stdio: 'ignore' });
if (dockerInfo.status !== 0) {
  console.log('integration tests skipped: docker unavailable');
  if (process.env.REQUIRE_INTEGRATION === '1') process.exit(1);
  process.exit(0);
}

const build = run('docker', [
  'build',
  '-t',
  'css-intellisense-it',
  path.join(repoRoot, 'test/integration'),
]);
if (build.status !== 0) process.exit(build.status ?? 1);

const result = run('docker', [
  'run',
  '--rm',
  '--init',
  '-v',
  `${repoRoot}:/work`,
  '-v',
  'css-intellisense-it-nm:/work/node_modules',
  '-v',
  'css-intellisense-it-vscode:/root/.vscode-test',
  '-w',
  '/work',
  'css-intellisense-it',
  'bash',
  '-lc',
  'npm ci --no-audit --no-fund && xvfb-run -a npm run test:integration:suite',
]);
process.exit(result.status ?? 1);
