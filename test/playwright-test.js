const { _electron: electron } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

const extensionPath = path.resolve(__dirname, '../');
const settingsDir = path.join(extensionPath, '.vscode-test', 'user-data-playwright', 'User');
const settingsPath = path.join(settingsDir, 'settings.json');

// Helper to get clipboard content on Windows using PowerShell
function getClipboardText() {
  try {
    return execSync('powershell -NoProfile -Command "Get-Clipboard"', { encoding: 'utf8' }).trim();
  } catch (err) {
    console.error("Failed to read clipboard:", err.message);
    return "";
  }
}

// Helper to clear clipboard content
function clearClipboard() {
  try {
    execSync('powershell -NoProfile -Command "Clear-Clipboard"', { stdio: 'ignore' });
  } catch (err) {
    // Ignore silently if Clear-Clipboard is not supported
  }
}

// Helper to write VS Code user settings.json
function updateSettings(config) {
  const defaultSettings = {
    "workbench.startupEditor": "none",
    "workbench.welcomePage.preferStartPage": false,
    "telemetry.telemetryLevel": "off",
    "xmlXpath.parentTag": null,
    "xmlXpath.mode": { "includeIndices": true, "includeAttributes": true },
    "xmlXpath.preferredAttributes": [],
    "xmlXpath.ignoreIndexTags": [],
    "xmlXpath.disableLeafIndex": false,
    "xmlXpath.skipSingleIndex": false,
    "xmlXpath.useParentScopedIndices": true, // Default is true for testCases in test-suite.js now
    "xmlXpath.ignoreParentSegment": false,
    "xmlXpath.forceIndexOneFor": [],
    "xmlXpath.exceptionsToIndexOneForcing": [],
    "xmlXpath.useAttributeBasedIndexing": false,
    "xmlXpath.attributeBasedIndexingAttribute": "",
    "xmlXpath.useRelativePath": false,
    "xmlXpath.includeNamespaces": false,
    "xmlXpath.includeDefaultNamespaces": false,
    "xmlXpath.defaultNamespacePrefix": "d"
  };

  const newSettings = { ...defaultSettings };
  if (config) {
    for (const [key, val] of Object.entries(config)) {
      newSettings[`xmlXpath.${key}`] = val;
    }
  }

  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), 'utf8');
}

// Helper to navigate cursor to specific line and character
async function goToLineAndCol(page, line, col) {
  // Trigger Go to Line input box (Ctrl+G)
  await page.keyboard.press('Control+G');
  await page.waitForTimeout(250);

  // Type line and col in the format line:col
  await page.keyboard.type(`${line}:${col}`);
  await page.waitForTimeout(250);

  // Press Enter to navigate and close input box
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
}

async function runPlaywrightTest() {
  console.log("=== Starting VS Code Extension Playwright E2E Test Suite ===");

  // 1. Locate VS Code Executable
  let vscodePath = process.env.VSCODE_PATH;
  if (!vscodePath) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const pathOptions = [
      path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft VS Code', 'Code.exe'),
    ];
    for (const p of pathOptions) {
      if (fs.existsSync(p)) {
        vscodePath = p;
        break;
      }
    }
  }

  if (!vscodePath) {
    console.error("❌ ERROR: Could not find VS Code executable.");
    console.log("Please set the VSCODE_PATH environment variable to your Code.exe path.");
    process.exit(1);
  }

  console.log(`✔ Found VS Code at: ${vscodePath}`);

  // 2. Set up paths
  const testWorkspace = path.resolve(__dirname, './test-workspace');
  if (!fs.existsSync(testWorkspace)) {
    fs.mkdirSync(testWorkspace, { recursive: true });
  }

  const xmlSourceFile = path.resolve(__dirname, 'test-file.xml');
  const xmlDestFile = path.resolve(testWorkspace, 'test-file.xml');
  fs.copyFileSync(xmlSourceFile, xmlDestFile);
  console.log(`✔ Copied test file to: ${xmlDestFile}`);

  // Load the test cases
  const { testCases } = require('./test-suite');
  console.log(`✔ Loaded ${testCases.length} test cases from test-suite.js`);

  // Clean up previous user data directory to avoid locks and state pollution
  const userDataDir = path.join(extensionPath, '.vscode-test', 'user-data-playwright');
  if (fs.existsSync(userDataDir)) {
    try {
      console.log("Cleaning up previous user data dir...");
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (e) {
      console.warn("Warning: Failed to clean up user data dir:", e.message);
    }
  }

  // Write initial empty settings
  updateSettings({});

  // 3. Launch VS Code under test
  console.log("🚀 Launching VS Code instance...");
  const electronApp = await electron.launch({
    executablePath: vscodePath,
    args: [
      `--extensionDevelopmentPath=${extensionPath}`,
      `--user-data-dir=${path.join(extensionPath, '.vscode-test', 'user-data-playwright')}`,
      `--extensions-dir=${path.join(extensionPath, '.vscode-test', 'extensions-playwright')}`,
      '--new-window',
      '--disable-workspace-trust',
      '--disable-gpu',
      '--skip-welcome',
      '--skip-release-notes',
      xmlDestFile
    ]
  });

  // Capture logs
  electronApp.process().stdout.on('data', (data) => console.log(`[VSCode Stdout] ${data.toString().trim()}`));
  electronApp.process().stderr.on('data', (data) => console.error(`[VSCode Stderr] ${data.toString().trim()}`));

  let passed = 0;
  let failed = 0;
  const failures = [];

  try {
    const page = await electronApp.firstWindow();
    console.log("✔ VS Code loaded:", await page.title());

    // Give it a moment to initialize the extension and open the editor
    console.log("Waiting for editor to initialize...");
    await page.waitForTimeout(6000);

    // Focus the editor first
    console.log("Focusing the editor...");
    await page.click('.monaco-editor');
    await page.waitForTimeout(500);

    // Run test cases
    for (let idx = 0; idx < testCases.length; idx++) {
      const tc = testCases[idx];
      console.log(`\n----------------------------------------`);
      console.log(`Running [${idx + 1}/${testCases.length}]: ${tc.description}`);

      // Update settings
      updateSettings(tc.config);
      await page.waitForTimeout(400); // Wait for VS Code to apply settings

      // Clear clipboard
      clearClipboard();

      // Navigate cursor
      await goToLineAndCol(page, tc.cursor.line, tc.cursor.character);

      // Trigger Copy XPath shortcut
      await page.keyboard.press('Control+Shift+C');

      // Poll clipboard to wait for copy to complete (handles E2E / OS clipboard latency)
      let clipboardResult = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        await page.waitForTimeout(200);
        clipboardResult = getClipboardText();
        if (clipboardResult && (clipboardResult.startsWith("/") || clipboardResult.startsWith("//"))) {
          break;
        }
      }
      console.log(`  Position:  L${tc.cursor.line}:C${tc.cursor.character}`);
      console.log(`  Expected:  "${tc.expectedXPath}"`);
      console.log(`  Actual:    "${clipboardResult}"`);

      if (clipboardResult === tc.expectedXPath) {
        console.log(`  ✅ PASS`);
        passed++;
      } else {
        console.log(`  ❌ FAIL`);
        failed++;
        failures.push({
          description: tc.description,
          position: `L${tc.cursor.line}:C${tc.cursor.character}`,
          expected: tc.expectedXPath,
          actual: clipboardResult
        });
      }
    }

  } catch (error) {
    console.error("❌ Test suite encountered a critical error:", error);
    process.exit(1);
  } finally {
    console.log("\nCleaning up settings...");
    updateSettings({});
    console.log("Closing VS Code...");
    await electronApp.close();
  }

  // Summary
  console.log("\n========================================");
  console.log("E2E TEST SUMMARY");
  console.log("========================================");
  console.log(`Total Tests: ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);

  if (failed > 0) {
    console.log("\nFailed Tests:");
    failures.forEach((f) => {
      console.log(`- ${f.description} (${f.position})`);
      console.log(`  Expected: "${f.expected}"`);
      console.log(`  Actual:   "${f.actual}"`);
    });
    process.exit(1);
  } else {
    console.log("\n🎉 All Playwright E2E tests passed!");
    process.exit(0);
  }
}

runPlaywrightTest();

