// ========== File: extension.js ==========

const vscode = require("vscode");
const XPathBuilder = require("./XPathBuilder.js");

const CONFIG_SECTION = "xmlXpath";
let statusBarItem;

// Global instance of our pure logic class
const xpathBuilder = new XPathBuilder();

// We override the 'loadConfiguration' method on our instance
// to use the real VS Code API. This is a clean way to inject dependencies.
xpathBuilder.loadConfiguration = function() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    parentTag: cfg.get("parentTag", null),
    mode: cfg.get("mode", { includeIndices: true, includeAttributes: true }),
    preferredAttributes: cfg.get("preferredAttributes", []),
    ignoreTags: new Set(cfg.get("ignoreIndexTags", [])),
    disableLeafIndex: cfg.get("disableLeafIndex", false),
    skipSingleIndex: cfg.get("skipSingleIndex", false),
    useXlinkLabelIndex: cfg.get("useXlinkLabelIndex", false),
    useParentScopedIndices: cfg.get("useParentScopedIndices", false),
    ignoreParentSegment: cfg.get("ignoreParentSegment", false),
  };
};

function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "xmlXpath.copyXPath";
  context.subscriptions.push(statusBarItem);

  registerCommands(context);

  const debouncedUpdate = debounce(update, 150);
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(debouncedUpdate));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(update));

  update();
}

function registerCommands(context) {
  const commands = {
    "xmlXpath.setParent": setParentTag,
    "xmlXpath.clearParent": () => updateConfig("parentTag", null, "Parent tag cleared."),
    "xmlXpath.setMode": setMode,
    "xmlXpath.setPreferredAttributes": () => updateConfig("preferredAttributes", "Preferred attributes (comma-separated)", (val) => val.split(',').map(s => s.trim()).filter(Boolean)),
    "xmlXpath.setIgnoreIndexTags": () => updateConfig("ignoreIndexTags", "Tags to ignore index [1] (comma-separated)", (val) => val.split(',').map(s => s.trim()).filter(Boolean)),
    "xmlXpath.copyXPath": copyXPath,
    "xmlXpath.toggleDisableLeafIndex": () => toggleConfig("disableLeafIndex", "Disable Leaf Index"),
    "xmlXpath.toggleSkipSingleIndex": () => toggleConfig("skipSingleIndex", "Skip Index [1]"),
    "xmlXpath.toggleUseXlinkLabelIndex": () => toggleConfig("useXlinkLabelIndex", "Use xlink:label Index"),
    "xmlXpath.toggleParentScopedIndexing": () => toggleConfig("useParentScopedIndices", "Parent-Scoped Indexing"),
    "xmlXpath.toggleIgnoreParentSegment": () => toggleConfig("ignoreParentSegment", "Ignore Parent Segment"),
    "xmlXpath.setTemplate": () => updateConfig("predicateTemplate", "Predicate template (use {attr1}, {attr1V}, {tag}, {idx})"),
  };

  for (const [name, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
  }
}

async function setParentTag() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const currentValue = cfg.get("parentTag", "");
  
  // Get the tag under cursor
  let tagUnderCursor = "";
  const editor = vscode.window.activeTextEditor;
  if (editor && isXmlLanguage(editor.document)) {
    try {
      // Get the current element stack
      const xml = editor.document.getText();
      const offset = editor.document.offsetAt(editor.selection.active);
      const config = xpathBuilder.loadConfiguration();
      
      const events = xpathBuilder.tokenizeXML(xml);
      if (events) {
        const stackResult = xpathBuilder.buildElementStack(events, offset, config);
        if (stackResult && stackResult.stack.length > 0) {
          // Get the tag name of the current element
          tagUnderCursor = stackResult.stack[stackResult.stack.length - 1].tag;
        }
      }
    } catch (error) {
      console.error("Error getting tag under cursor:", error);
    }
  }
  
  const value = await vscode.window.showInputBox({
    prompt: "Parent tag for relative XPath",
    value: tagUnderCursor || currentValue, // Prefer tag under cursor
    placeHolder: currentValue || tagUnderCursor || "e.g., section, div, body"
  });
  
  if (value !== undefined) {
    await cfg.update("parentTag", value || null, vscode.ConfigurationTarget.Global);
    update();
    
    // Show confirmation with example
    if (value) {
      vscode.window.showInformationMessage(`Parent tag set to: ${value}. XPaths will now be relative to <${value}>`);
    }
  }
}

function deactivate() {
  if (statusBarItem) statusBarItem.dispose();
}

function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

async function updateConfig(key, prompt, transformer) {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const currentValue = cfg.get(key);
  
  // Format current value for display
  let placeholderValue = '';
  if (currentValue !== null && currentValue !== undefined) {
    if (Array.isArray(currentValue)) {
      placeholderValue = currentValue.join(', ');
    } else {
      placeholderValue = String(currentValue);
    }
  }
  
  const value = await vscode.window.showInputBox({ 
    prompt,
    value: placeholderValue, // Pre-fill with current value
    placeHolder: placeholderValue || 'No value set'
  });
  
  if (value !== undefined) {
    const finalValue = transformer ? transformer(value) : (value || null);
    await cfg.update(key, finalValue, vscode.ConfigurationTarget.Global);
    update();
  }
}

async function toggleConfig(key, message) {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get(key, false);
  await cfg.update(key, !current, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`${message}: ${!current ? "ON" : "OFF"}`);
  update();
}

async function setMode() {
  const options = [
    { label: "Both", value: { includeIndices: true, includeAttributes: true } },
    { label: "Attributes Only", value: { includeIndices: false, includeAttributes: true } },
    { label: "Indices Only", value: { includeIndices: true, includeAttributes: false } },
    { label: "Simple (Tag path only)", value: { includeIndices: false, includeAttributes: false } },
  ];
  const pick = await vscode.window.showQuickPick(options, { placeHolder: "Select XPath generation mode" });
  if (pick) {
    await vscode.workspace.getConfiguration(CONFIG_SECTION).update("mode", pick.value, vscode.ConfigurationTarget.Global);
    update();
  }
}

async function copyXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) return;
  try {
    const xpath = xpathBuilder.buildXPathRegex(editor.document, editor.selection.active);
    if (xpath) {
      await vscode.env.clipboard.writeText(xpath);
      vscode.window.showInformationMessage(`Copied: ${xpath}`);
    }
  } catch (error) {
    console.error("Error copying XPath:", error);
    vscode.window.showErrorMessage("Could not compute XPath.");
  }
}

function isXmlLanguage(document) {
  const xmlLanguages = ["xml", "xsl", "xsd", "wsdl", "xaml", "svg", "xhtml"];
  return xmlLanguages.includes(document.languageId);
}

function update() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) {
    return statusBarItem.hide();
  }

  try {
    const config = xpathBuilder.loadConfiguration();
    
    // Debug: Show current config state
    if (config.useXlinkLabelIndex) {
      console.log("xlink:label indexing is ENABLED");
    }
    
    const xpath = xpathBuilder.buildXPathRegex(editor.document, editor.selection.active);
    if (xpath) {
      const displayXPath = xpath.length > 80 ? xpath.substring(0, 77) + "..." : xpath;
      statusBarItem.text = `$(code) ${displayXPath}`;
      statusBarItem.tooltip = `XPath: ${xpath}\n(Click to copy)`;
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  } catch (error) {
    console.error("Error updating status bar:", error);
    statusBarItem.hide();
  }
}
module.exports = {
  activate,
  deactivate,
};