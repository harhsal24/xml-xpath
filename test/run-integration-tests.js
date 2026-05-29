const path = require('path');
const os = require('os');
const fs = require('fs');
const { runTests } = require('@vscode/test-electron');

async function main() {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const vscodeExecutablePath = path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe');

    if (!fs.existsSync(vscodeExecutablePath)) {
      throw new Error(`VS Code executable not found at: ${vscodeExecutablePath}`);
    }

    // Use short 8.3 paths to bypass space-splitting bugs
    const extensionDevelopmentPath = 'C:\\Users\\harsh\\OneDrive\\Desktop\\VSCODE~1\\xml-xpath';
    const extensionTestsPath = 'C:\\Users\\harsh\\OneDrive\\Desktop\\VSCODE~1\\xml-xpath\\test\\suite\\index';

    console.log(`Running VS Code integration tests using:`);
    console.log(`- Executable: ${vscodeExecutablePath}`);
    console.log(`- Development Path: ${extensionDevelopmentPath}`);
    console.log(`- Tests Path: ${extensionTestsPath}`);

    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        '--new-window',
        '--disable-gpu',
        '--disable-workspace-trust'
      ]
    });
  } catch (err) {
    console.error('Failed to run tests:', err.message);
    process.exit(1);
  }
}

main();
