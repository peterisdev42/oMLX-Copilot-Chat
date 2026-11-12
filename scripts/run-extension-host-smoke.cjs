// Real VS Code integration smoke test; the CI job installs
// @vscode/test-electron temporarily so production package deps stay unchanged.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const root = path.resolve(__dirname, '..');
  const testProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'omlx-vscode-smoke-'));
  try {
    await runTests({
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(root, 'out', 'test', 'extensionHost.js'),
      launchArgs: [
        '--disable-extensions',
        `--user-data-dir=${path.join(testProfile, 'user-data')}`,
        `--extensions-dir=${path.join(testProfile, 'extensions')}`,
        '--no-sandbox',
        '--disable-gpu',
        '--skip-welcome'
      ]
    });
  } finally {
    fs.rmSync(testProfile, { force: true, recursive: true });
  }
}

main().catch(error => {
  console.error('Real VS Code extension-host smoke test failed:', error);
  process.exitCode = 1;
});
