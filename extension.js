// ========== File: extension.js ==========

const vscode = require("vscode");
const XPathBuilder = require("./XPathBuilder.js");
const configManager = require("./lib/configManager.js");
const xpathSearcher = require("./lib/xpathSearcher.js");

const CONFIG_SECTION = configManager.CONFIG_SECTION;
let statusBarItem;

const xpathBuilder = new XPathBuilder();

// Inject VS Code-backed configuration loader into the builder
xpathBuilder.loadConfiguration = function () {
  return configManager.loadVSCodeConfiguration(vscode);
};

// ------------------------ Utilities ------------------------

function isXmlLanguage(document) {
  const xmlLanguages = ["xml", "xsl", "xsd", "wsdl", "xaml", "svg", "xhtml"];
  return xmlLanguages.includes(document.languageId);
}

function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function truncate(s, n = 120) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ------------------------ Editor selection & commands ------------------------

async function searchWithXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) {
    vscode.window.showWarningMessage("Please open an XML file to search.");
    return;
  }

  // Try clipboard first
  let xpath = await vscode.env.clipboard.readText();

  // If clipboard doesn't contain a plausible xpath, prompt user
  if (!xpath || (!xpath.startsWith("/") && !xpath.startsWith("//"))) {
    xpath = await vscode.window.showInputBox({
      prompt: "Enter XPath to search (leading / or // recommended)",
      placeHolder: "/root/element[@id='example']",
      value: xpath || "",
      validateInput: (value) => {
        if (!value) return "XPath cannot be empty";
        if (!value.startsWith("/") && !value.startsWith("//")) return "XPath should start with / or //";
        return null;
      },
    });

    if (!xpath) return;
  }

  try {
    const config = xpathBuilder.loadConfiguration();
    const result = await xpathSearcher.findElementByXPath(editor, xpath, config);

    if (result) {
      // Translate offsets to positions and select
      const doc = editor.document;
      const startPos = doc.positionAt(result.startOffset);
      // Ensure endOffset is within document
      const endOffsetClamped = Math.max(0, Math.min(result.endOffset || result.startOffset, doc.getText().length));
      const endPos = doc.positionAt(endOffsetClamped);

      // Select match (start -> end). Place cursor at start if start==end
      editor.selection = new vscode.Selection(startPos, endPos);
      editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenter);

      if (result.isPartial) {
        vscode.window.showWarningMessage(
          `Partial match (${result.matchedDepth}/${result.totalDepth}) — selected closest matched element <${result.tagName}> at line ${startPos.line + 1}.`
        );
      } else {
        vscode.window.showInformationMessage(`Found and selected <${result.tagName}> at line ${startPos.line + 1}.`);
      }
    } else {
      vscode.window.showWarningMessage(`XPath not found: ${xpath}`);
    }
  } catch (err) {
    console.error("searchWithXPath error:", err);
    vscode.window.showErrorMessage(`Invalid XPath or error: ${err.message || err}`);
  }
}

// Keep update/statusbar behavior mostly the same
function update() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) {
    if (statusBarItem) statusBarItem.hide();
    return;
  }

  try {
    const config = xpathBuilder.loadConfiguration();
    if (config.useAttributeBasedIndexing) {
      const abAttrDisplay = Array.isArray(config.attributeBasedIndexingAttribute)
        ? config.attributeBasedIndexingAttribute.join(", ")
        : (config.attributeBasedIndexingAttribute || "(auto)");
      console.log(`Attribute-based indexing enabled: ${abAttrDisplay}`);
    }
    const xpath = xpathBuilder.buildXPathRegex(editor.document, editor.selection.active, config);
    if (xpath) {
      const display = xpath.length > 80 ? xpath.substring(0, 77) + "..." : xpath;
      statusBarItem.text = `$(code) ${display}`;
      statusBarItem.tooltip = `XPath: ${truncate(xpath, 800)}\n(Click to copy)`;
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  } catch (error) {
    console.error("Error updating status bar:", error);
    if (statusBarItem) statusBarItem.hide();
  }
}

// ------------------------ Registration & activation ------------------------

function registerCommands(context) {
  const commands = {
    "xmlXpath.setParent": setParentTag,
    "xmlXpath.clearParent": clearParentTag,
    "xmlXpath.setMode": setMode,
    "xmlXpath.setPreferredAttributes": () => updateConfig("preferredAttributes", "Preferred attributes (comma-separated)", (v) => v.split(",").map(s => s.trim()).filter(Boolean)),
    "xmlXpath.setIgnoreIndexTags": () => updateConfig("ignoreIndexTags", "Tags to ignore index [1] (comma-separated)", (v) => v.split(",").map(s => s.trim()).filter(Boolean)),
    "xmlXpath.copyXPath": copyXPath,
    "xmlXpath.copyUniversalXPath": copyUniversalXPath,
    "xmlXpath.toggleDisableLeafIndex": () => toggleConfig("disableLeafIndex", "Disable Leaf Index"),
    "xmlXpath.toggleSkipSingleIndex": () => toggleConfig("skipSingleIndex", "Skip Index [1]"),
    "xmlXpath.toggleUseXlinkLabelIndex": () => toggleConfig("useXlinkLabelIndex", "Use xlink:label Index"),
    "xmlXpath.toggleParentScopedIndexing": () => toggleConfig("useParentScopedIndices", "Parent-Scoped Indexing"),
    "xmlXpath.toggleIgnoreParentSegment": () => toggleConfig("ignoreParentSegment", "Ignore Parent Segment"),
    "xmlXpath.setTemplate": setPredicateTemplate,
    "xmlXpath.setXlinkLabelPattern": setXlinkLabelPattern,
    "xmlXpath.searchWithXPath": searchWithXPath,
    "xmlXpath.setForceIndexOneFor": () => updateConfig("forceIndexOneFor", "Tags to force index [1] (comma-separated)", (v) => v.split(",").map(s => s.trim()).filter(Boolean)),
    "xmlXpath.setExceptionsToIndexOneForcing": () => updateConfig("exceptionsToIndexOneForcing", "Tags that are exceptions to force index [1] (comma-separated)", (v) => v.split(",").map(s => s.trim()).filter(Boolean)),
    "xmlXpath.toggleAttributeBasedIndexing": () => toggleConfig("useAttributeBasedIndexing", "Attribute-Based Indexing"),
    "xmlXpath.setAttributeBasedIndexingAttribute": setAttributeBasedIndexingAttribute,
    "xmlXpath.toggleUseRelativePath": toggleUseRelativePath,
    "xmlXpath.toggleIncludeNamespaces": toggleIncludeNamespaces,
    "xmlXpath.toggleIncludeDefaultNamespaces": toggleIncludeDefaultNamespaces,
    "xmlXpath.setRelativeMustIncludeTags": () => updateConfig("relativeMustIncludeTags", "Relative must-include tags (comma-separated)", (v) => v.split(",").map(s => s.trim()).filter(Boolean)),
    "xmlXpath.setRelativeMustIgnoreTags": () => updateConfig("relativeMustIgnoreTags", "Relative must-ignore tags (comma-separated)", (v) => v.split(",").map(s => s.trim()).filter(Boolean)),
    "xmlXpath.setRelativeDontIgnoreAfter": () => updateConfig("relativeDontIgnoreAfter", "Relative 'Don't Ignore After' anchor tag name"),
    "xmlXpath.clearRelativeDontIgnoreAfter": clearRelativeDontIgnoreAfter,
    "xmlXpath.recalculateXPath": recalculateXPath
  };

  for (const [name, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
  }
}

// ---------- helper UI/setters ----------

async function setParentTag() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const currentValue = cfg.get("parentTag", "");

  let tagUnderCursor = "";
  const editor = vscode.window.activeTextEditor;
  if (editor && isXmlLanguage(editor.document)) {
    try {
      const xml = editor.document.getText();
      const offset = editor.document.offsetAt(editor.selection.active);
      const config = xpathBuilder.loadConfiguration();
      const events = xpathBuilder.tokenizeXML(xml, config);
      if (events) {
        const stackResult = xpathBuilder.buildElementStack(events, offset, config);
        if (stackResult && stackResult.stack.length > 0) {
          tagUnderCursor = stackResult.stack[stackResult.stack.length - 1].tag;
        }
      }
    } catch (err) {
      console.error("Error fetching tag under cursor:", err);
    }
  }

  const value = await vscode.window.showInputBox({
    prompt: "Parent tag for relative XPath",
    value: tagUnderCursor || currentValue,
    placeHolder: currentValue || tagUnderCursor || "e.g., section, div, body",
  });

  if (value !== undefined) {
    await cfg.update("parentTag", value || null, vscode.ConfigurationTarget.Global);
    update();
    if (value) vscode.window.showInformationMessage(`Parent tag set to: ${value}`);
  }
}

async function clearParentTag() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await cfg.update("parentTag", null, vscode.ConfigurationTarget.Global);
  update();
  vscode.window.showInformationMessage("Parent tag cleared.");
}

async function setPredicateTemplate() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const currentValue = cfg.get("predicateTemplate", "[@{attr1}='{attr1V}']");

  const examples = [
    { label: "Default: [@attr='value']", value: "[@{attr1}='{attr1V}']" },
    { label: "Position: [@attr='value'][position()=n]", value: "[@{attr1}='{attr1V}'][position()={idx}]" },
    { label: "Text: [text()='value']", value: "[text()='{attr1V}']" },
    { label: "Custom...", value: "__custom__" },
  ];

  const pick = await vscode.window.showQuickPick(examples, { placeHolder: "Select predicate template or Custom" });
  if (!pick) return;

  let value = pick.value;
  if (value === "__custom__") {
    value = await vscode.window.showInputBox({
      prompt: "Predicate template. Tokens: {at}=@, {attr1}, {attr1V}, {tag}, {idx}, {xllv}, {xllvI}",
      value: currentValue,
      placeHolder: "[@{attr1}='{attr1V}']",
    });
  }

  if (value) {
    await cfg.update("predicateTemplate", value, vscode.ConfigurationTarget.Global);
    update();
    const example = value.replace(/{at}/g, "@").replace(/{attr1}/g, "id").replace(/{attr1V}/g, "example").replace(/{tag}/g, "div").replace(/{idx}/g, "1");
    vscode.window.showInformationMessage(`Template set. Example: ${example}`);
  }
}

async function setXlinkLabelPattern() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const currentPattern = cfg.get("xlinkLabelPattern", { type: "any", pattern: "" });

  const types = [
    { label: "Any number", value: { type: "any", pattern: "" } },
    { label: "Starts with", value: { type: "startsWith", pattern: "__input__" } },
    { label: "Contains", value: { type: "contains", pattern: "__input__" } },
    { label: "Ends with", value: { type: "endsWith", pattern: "__input__" } },
    { label: "Regex", value: { type: "regex", pattern: "__input__" } },
    { label: "Exact prefix", value: { type: "exactPrefix", pattern: "__input__" } }
  ];

  const pick = await vscode.window.showQuickPick(types, { placeHolder: "Select xlink:label pattern type" });
  if (!pick) return;

  let pattern = pick.value.pattern;
  if (pattern === "__input__") {
    pattern = await vscode.window.showInputBox({ prompt: `Enter pattern for ${pick.label}`, value: currentPattern.type === pick.value.type ? currentPattern.pattern : "" });
    if (pattern === undefined) return;
  }

  const newPattern = { type: pick.value.type, pattern };
  await cfg.update("xlinkLabelPattern", newPattern, vscode.ConfigurationTarget.Global);
  update();
  vscode.window.showInformationMessage(`xlink:label pattern set to: ${newPattern.type}${pattern ? ` "${pattern}"` : ""}`);
}

async function copyUniversalXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) return;

  try {
    const currentConfig = xpathBuilder.loadConfiguration();
    const universalConfig = {
      parentTag: null,
      mode: { includeIndices: true, includeAttributes: true },
      preferredAttributes: currentConfig.preferredAttributes || ["id", "name"],
      ignoreTags: new Set(),
      disableLeafIndex: false,
      skipSingleIndex: false,
      useXlinkLabelIndex: false,
      useParentScopedIndices: true,
      ignoreParentSegment: false,
      predicateTemplate: "[@{attr1}='{attr1V}']",
      xlinkLabelPattern: { type: "any", pattern: "" },
      forceIndexOneFor: new Set(),
      exceptionsToIndexOneForcing: new Set(),
      useAttributeBasedIndexing: currentConfig.useAttributeBasedIndexing,
      attributeBasedIndexingAttribute: currentConfig.attributeBasedIndexingAttribute,
    };

    const xpath = xpathBuilder.buildXPathRegex(editor.document, editor.selection.active, universalConfig);

    if (xpath) {
      await vscode.env.clipboard.writeText(xpath);
      vscode.window.showInformationMessage(`Copied universal XPath: ${truncate(xpath, 300)}`);
    }
  } catch (err) {
    console.error("copyUniversalXPath error:", err);
    vscode.window.showErrorMessage("Could not compute universal XPath.");
  }
}

async function copyXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) return;

  try {
    const config = xpathBuilder.loadConfiguration();
    const xpath = xpathBuilder.buildXPathRegex(editor.document, editor.selection.active, config);
    if (xpath) {
      await vscode.env.clipboard.writeText(xpath);
      vscode.window.showInformationMessage(`Copied: ${truncate(xpath, 300)}`);
    }
  } catch (err) {
    console.error("copyXPath error:", err);
    vscode.window.showErrorMessage("Could not compute XPath.");
  }
}

async function recalculateXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) {
    vscode.window.showWarningMessage("No active XML document found.");
    return;
  }

  try {
    update();
    const config = xpathBuilder.loadConfiguration();
    const xpath = xpathBuilder.buildXPathRegex(editor.document, editor.selection.active, config);
    if (xpath) {
      vscode.window.showInformationMessage(`Recalculated XPath: ${xpath}`);
    } else {
      vscode.window.showWarningMessage("Could not generate XPath at current cursor position.");
    }
  } catch (err) {
    console.error("recalculateXPath error:", err);
    vscode.window.showErrorMessage(`Error recalculating XPath: ${err.message || err}`);
  }
}

async function updateConfig(key, prompt, transform) {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get(key);
  const defaultText = Array.isArray(current) ? current.join(", ") : (current == null ? "" : String(current));
  const val = await vscode.window.showInputBox({ prompt, value: defaultText, placeHolder: defaultText || "No value set" });

  if (val !== undefined) {
    const out = transform ? transform(val) : val;
    await cfg.update(key, out, vscode.ConfigurationTarget.Global);
    update();
  }
}

async function toggleConfig(key, title) {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const cur = cfg.get(key, false);
  await cfg.update(key, !cur, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`${title}: ${!cur ? "ON" : "OFF"}`);
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

async function setAttributeBasedIndexingAttribute() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("attributeBasedIndexingAttribute", "");
  const preferredAttrs = cfg.get("preferredAttributes", []);
  const items = preferredAttrs.map(a => ({ label: a, description: "Preferred attribute" }));
  items.push({ label: "Custom...", description: "Enter custom attribute name" });

  const pick = await vscode.window.showQuickPick(items, { placeHolder: "Select attribute for attribute-based indexing" });
  if (!pick) return;

  let value = pick.label;
  if (value === "Custom...") {
    const defaultText = Array.isArray(current) ? current.join(", ") : current;
    const input = await vscode.window.showInputBox({ prompt: "Attribute name(s) for attribute-based indexing (comma separated for multiple)", value: defaultText, placeHolder: "e.g., valuationType, id" });
    if (!input) return;
    const parts = input.split(",").map(s => s.trim()).filter(Boolean);
    value = parts.length > 1 ? parts : (parts[0] || "");
  }

  await cfg.update("attributeBasedIndexingAttribute", value, vscode.ConfigurationTarget.Global);
  update();
  const valueStr = Array.isArray(value) ? value.join(", ") : value;
  vscode.window.showInformationMessage(`Attribute-based indexing will use: ${valueStr}`);
}

async function clearRelativeDontIgnoreAfter() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await cfg.update("relativeDontIgnoreAfter", "", vscode.ConfigurationTarget.Global);
  update();
  vscode.window.showInformationMessage("Relative 'Don't Ignore After' anchor cleared.");
}

async function toggleUseRelativePath() { await toggleConfig("useRelativePath", "Use Relative Path"); }
async function toggleIncludeNamespaces() { await toggleConfig("includeNamespaces", "Include Namespaces"); }
async function toggleIncludeDefaultNamespaces() { await toggleConfig("includeDefaultNamespaces", "Include Default Namespaces"); }

// ------------------------ Activation ------------------------

function activate(context) {
  try {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = "xmlXpath.copyXPath";
    context.subscriptions.push(statusBarItem);

    registerCommands(context);

    const debouncedUpdate = debounce(update, 150);
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(debouncedUpdate));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(update));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) update();
    }));

    update();
    console.log("XML XPath extension activated");
  } catch (e) {
    console.error("Activation error:", e);
    vscode.window.showErrorMessage(`Failed to activate XML XPath extension: ${e.message || e}`);
  }
}

function deactivate() {
  if (statusBarItem) statusBarItem.dispose();
}

module.exports = { activate, deactivate };
