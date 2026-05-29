const assert = require('assert');
const vscode = require('vscode');
const path = require('path');

async function updateConfig(key, value) {
  const config = vscode.workspace.getConfiguration('xmlXpath');
  const inspect = config.inspect(key);
  if (inspect && JSON.stringify(inspect.globalValue) === JSON.stringify(value)) {
    return;
  }
  await config.update(key, value, vscode.ConfigurationTarget.Global);
  // Wait 300ms for configuration change event to propagate to the extension host
  await new Promise(resolve => setTimeout(resolve, 300));
}

suite('XML XPath Extension Integration Tests', function () {
  this.timeout(15000);
  let xmlUri;

  suiteSetup(async () => {
    const xmlPath = path.resolve(__dirname, './test-suite.xml');
    xmlUri = vscode.Uri.file(xmlPath);
  });

  setup(async function() {
    this.timeout(15000);
    // Reset configuration to clean defaults to avoid cross-test pollution
    await updateConfig('useParentScopedIndices', true);
    await updateConfig('useAttributeBasedIndexing', false);
    await updateConfig('attributeBasedIndexingAttribute', '');
    await updateConfig('preferredAttributes', []);
    await updateConfig('mode', { includeIndices: true, includeAttributes: true });
    await updateConfig('includeNamespaces', false);
    await updateConfig('includeDefaultNamespaces', false);
    await updateConfig('defaultNamespacePrefix', 'd');
    await updateConfig('useRelativePath', false);
  });

  test('Parent-scoped indexing works correctly (registers reset per parent)', async () => {
    const doc = await vscode.workspace.openTextDocument(xmlUri);
    const editor = await vscode.window.showTextDocument(doc);

    await updateConfig('useParentScopedIndices', true);
    await updateConfig('useAttributeBasedIndexing', false);
    await updateConfig('mode', { includeIndices: true, includeAttributes: false });

    // Position cursor inside the Comment tag on line 69 (0-indexed line 68)
    const pos = new vscode.Position(68, 25);
    editor.selection = new vscode.Selection(pos, pos);

    // Execute the copy XPath command
    await vscode.commands.executeCommand('xmlXpath.copyXPath');

    // Read clipboard contents
    const copiedXPath = await vscode.env.clipboard.readText();
    const expectedXPath = '/MegaStoreInventory[1]/CustomerFeedback[1]/Feedback[2]/Comment[1]';

    assert.strictEqual(copiedXPath, expectedXPath);
  });

  test('Global indexing works correctly when parent-scoped is false', async () => {
    const doc = await vscode.workspace.openTextDocument(xmlUri);
    const editor = await vscode.window.showTextDocument(doc);

    await updateConfig('useParentScopedIndices', false);
    await updateConfig('useAttributeBasedIndexing', false);
    await updateConfig('mode', { includeIndices: true, includeAttributes: false });

    // Position cursor inside the Comment tag on line 69 (0-indexed line 68)
    const pos = new vscode.Position(68, 25);
    editor.selection = new vscode.Selection(pos, pos);

    // Execute the copy XPath command
    await vscode.commands.executeCommand('xmlXpath.copyXPath');

    // Read clipboard contents
    const copiedXPath = await vscode.env.clipboard.readText();
    const expectedXPath = '/MegaStoreInventory[1]/CustomerFeedback[1]/Feedback[2]/Comment[3]';

    assert.strictEqual(copiedXPath, expectedXPath);
  });

  test('Attribute-based indexing respects parent-scoped mode when useParentScopedIndices is true', async () => {
    const scopingXmlUri = vscode.Uri.file(path.resolve(__dirname, './scoping-test.xml'));
    const doc = await vscode.workspace.openTextDocument(scopingXmlUri);
    const editor = await vscode.window.showTextDocument(doc);

    await updateConfig('useParentScopedIndices', true);
    await updateConfig('useAttributeBasedIndexing', true);
    await updateConfig('attributeBasedIndexingAttribute', 'type');
    await updateConfig('preferredAttributes', ['id', 'type']);
    await updateConfig('mode', { includeIndices: true, includeAttributes: true });

    // Position cursor inside the child tag on line 8 (0-indexed line 7)
    const pos = new vscode.Position(7, 20);
    editor.selection = new vscode.Selection(pos, pos);

    await vscode.commands.executeCommand('xmlXpath.copyXPath');

    const copiedXPath = await vscode.env.clipboard.readText();
    // With parent scoping, it should reset under p2: /root[1]/parent[@id='p2'][2]/child[@type='a'][1]
    const expectedXPath = "/root[1]/parent[@id='p2'][2]/child[@type='a'][1]";

    assert.strictEqual(copiedXPath, expectedXPath);
  });

  test('Attribute-based indexing uses global depth when useParentScopedIndices is false', async () => {
    const scopingXmlUri = vscode.Uri.file(path.resolve(__dirname, './scoping-test.xml'));
    const doc = await vscode.workspace.openTextDocument(scopingXmlUri);
    const editor = await vscode.window.showTextDocument(doc);

    await updateConfig('useParentScopedIndices', false);
    await updateConfig('useAttributeBasedIndexing', true);
    await updateConfig('attributeBasedIndexingAttribute', 'type');
    await updateConfig('preferredAttributes', ['id', 'type']);
    await updateConfig('mode', { includeIndices: true, includeAttributes: true });

    // Position cursor inside the child tag on line 8 (0-indexed line 7)
    const pos = new vscode.Position(7, 20);
    editor.selection = new vscode.Selection(pos, pos);

    await vscode.commands.executeCommand('xmlXpath.copyXPath');

    const copiedXPath = await vscode.env.clipboard.readText();
    // With global depth, it counts globally at depth 2 (child is 3rd): /root[1]/parent[@id='p2'][2]/child[@type='a'][3]
    const expectedXPath = "/root[1]/parent[@id='p2'][2]/child[@type='a'][3]";

    assert.strictEqual(copiedXPath, expectedXPath);
  });

  test('Multi-attribute indexing works correctly with multiple configured attributes', async () => {
    const scopingXmlUri = vscode.Uri.file(path.resolve(__dirname, './scoping-test.xml'));
    const doc = await vscode.workspace.openTextDocument(scopingXmlUri);
    const editor = await vscode.window.showTextDocument(doc);

    await updateConfig('useParentScopedIndices', true);
    await updateConfig('useAttributeBasedIndexing', true);
    await updateConfig('attributeBasedIndexingAttribute', ['valuationType', 'id']);
    await updateConfig('preferredAttributes', ['valuationType', 'id']);
    await updateConfig('mode', { includeIndices: true, includeAttributes: true });

    // 1. <item valuationType="A" id="x">Item 3</item> at line 14 (0-indexed line 13)
    // It should have valuationType="A", id="x", and index [2] because Item 1 also has them
    const pos1 = new vscode.Position(13, 10);
    editor.selection = new vscode.Selection(pos1, pos1);
    await vscode.commands.executeCommand('xmlXpath.copyXPath');
    const copiedXPath1 = await vscode.env.clipboard.readText();
    const expectedXPath1 = "/root[1]/valuation-test[1]/item[@valuationType='A'][@id='x'][2]";
    assert.strictEqual(copiedXPath1, expectedXPath1);

    // 2. <item valuationType="A">Item 5</item> at line 16 (0-indexed line 15)
    // It has only valuationType="A". It should be index [2] because Item 4 also has only valuationType="A"
    const pos2 = new vscode.Position(15, 10);
    editor.selection = new vscode.Selection(pos2, pos2);
    await vscode.commands.executeCommand('xmlXpath.copyXPath');
    const copiedXPath2 = await vscode.env.clipboard.readText();
    const expectedXPath2 = "/root[1]/valuation-test[1]/item[@valuationType='A'][2]";
    assert.strictEqual(copiedXPath2, expectedXPath2);

    // 3. <item id="x">Item 7</item> at line 18 (0-indexed line 17)
    // It has only id="x". It should be index [2] because Item 6 also has only id="x"
    const pos3 = new vscode.Position(17, 10);
    editor.selection = new vscode.Selection(pos3, pos3);
    await vscode.commands.executeCommand('xmlXpath.copyXPath');
    const copiedXPath3 = await vscode.env.clipboard.readText();
    const expectedXPath3 = "/root[1]/valuation-test[1]/item[@id='x'][2]";
    assert.strictEqual(copiedXPath3, expectedXPath3);
  });

  test('Default namespace uses configured defaultNamespacePrefix (e.g. d:)', async () => {
    const scopingXmlUri = vscode.Uri.file(path.resolve(__dirname, './scoping-test.xml'));
    const doc = await vscode.workspace.openTextDocument(scopingXmlUri);
    const editor = await vscode.window.showTextDocument(doc);

    await updateConfig('includeNamespaces', true);
    await updateConfig('includeDefaultNamespaces', true);
    await updateConfig('defaultNamespacePrefix', 'd');
    await updateConfig('mode', { includeIndices: true, includeAttributes: false });

    // Position cursor inside <item>Namespace item</item> on line 22 (0-indexed line 21)
    const pos = new vscode.Position(21, 10);
    editor.selection = new vscode.Selection(pos, pos);

    await vscode.commands.executeCommand('xmlXpath.copyXPath');
    const copiedXPathDefault = await vscode.env.clipboard.readText();
    assert.strictEqual(copiedXPathDefault, "/root[1]/d:default-ns-test[1]/d:item[1]");

    await updateConfig('defaultNamespacePrefix', 'ns');
    await vscode.commands.executeCommand('xmlXpath.copyXPath');
    const copiedXPathCustom = await vscode.env.clipboard.readText();
    assert.strictEqual(copiedXPathCustom, "/root[1]/ns:default-ns-test[1]/ns:item[1]");
  });
});
