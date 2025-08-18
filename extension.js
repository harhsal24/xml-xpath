// extension.js — cleaned, refactored, notification toggle + richer notifications
const vscode = require("vscode");
const XPathBuilder = require("./XPathBuilder");

let statusBarItem = null;
let builder = null;

function defaultConfig() {
  return {
    parentTag: null,
    mode: { includeIndices: true, includeAttributes: true },
    preferredAttributes: [],
    ignoreTags: [],
    disableLeafIndex: false,
    skipSingleIndex: false,
    useXlinkLabelIndex: false,
    useParentScopedIndices: false,
    ignoreParentSegment: false,
    predicateTemplate: "[@{attr1}='{attr1V}']",
    xlinkLabelPattern: { type: "any", pattern: "" },
    forceIndexOneFor: [],
    exceptionsToIndexOneForcing: [],
    useAttributeBasedIndexing: false,
    attributeBasedIndexingAttribute: "",
    useRelativePath: false,
    includeNamespaces: false,
    includeDefaultNamespaces: false,
    useSmartRelativePath: false,
    smartRelativeNamespacePrefix: "d",
    smartRelativeSignificantAttributes: [],
    smartRelativeIdentifyingChildren: undefined,
    smartRelativeSingleLine: false,
    smartRelativeVirtualRoot: "",
    smartRelativeVirtualRootMode: "include",
    smartRelativeIgnoreLastElement: false,
    smartRelativeAlwaysIncludeTags: [],
    smartRelativeDontIgnoreAfter: "",
    smartRelativeLandmarkMode: true,
    smartRelativeIndentSize: 4,
    relativeMustIncludeTags: [],
    relativeMustIgnoreTags: [],
    relativeDontIgnoreAfter: "",
    relativeNamespacePrefix: "d",
    // NEW (local-only default): controls whether we show popup messages
    showNotifications: true
  };
}

function getWorkspaceConfig() {
  const cfg = vscode.workspace.getConfiguration("xmlXpath");
  const base = defaultConfig();

  return {
    parentTag: cfg.get("parentTag", base.parentTag),
    mode: cfg.get("mode", base.mode),
    preferredAttributes: cfg.get("preferredAttributes", base.preferredAttributes),
    ignoreTags: cfg.get("ignoreIndexTags", base.ignoreTags),
    disableLeafIndex: cfg.get("disableLeafIndex", base.disableLeafIndex),
    skipSingleIndex: cfg.get("skipSingleIndex", base.skipSingleIndex),
    useXlinkLabelIndex: cfg.get("useXlinkLabelIndex", base.useXlinkLabelIndex),
    useParentScopedIndices: cfg.get("useParentScopedIndices", base.useParentScopedIndices),
    ignoreParentSegment: cfg.get("ignoreParentSegment", base.ignoreParentSegment),
    predicateTemplate: cfg.get("predicateTemplate", base.predicateTemplate),
    xlinkLabelPattern: cfg.get("xlinkLabelPattern", base.xlinkLabelPattern),
    forceIndexOneFor: cfg.get("forceIndexOneFor", base.forceIndexOneFor),
    exceptionsToIndexOneForcing: cfg.get("exceptionsToIndexOneForcing", base.exceptionsToIndexOneForcing),
    useAttributeBasedIndexing: cfg.get("useAttributeBasedIndexing", base.useAttributeBasedIndexing),
    attributeBasedIndexingAttribute: cfg.get("attributeBasedIndexingAttribute", base.attributeBasedIndexingAttribute),
    useRelativePath: cfg.get("useRelativePath", base.useRelativePath),
    includeNamespaces: cfg.get("includeNamespaces", base.includeNamespaces),
    includeDefaultNamespaces: cfg.get("includeDefaultNamespaces", base.includeDefaultNamespaces),

    // smart-relative
    useSmartRelativePath: cfg.get("useSmartRelativePath", base.useSmartRelativePath),
    smartRelativeNamespacePrefix: cfg.get("smartRelativeNamespacePrefix", base.smartRelativeNamespacePrefix),
    smartRelativeSignificantAttributes: cfg.get("smartRelativeSignificantAttributes", base.smartRelativeSignificantAttributes),
    smartRelativeIdentifyingChildren: cfg.get("smartRelativeIdentifyingChildren", base.smartRelativeIdentifyingChildren),
    smartRelativeSingleLine: cfg.get("smartRelativeSingleLine", base.smartRelativeSingleLine),
    smartRelativeVirtualRoot: cfg.get("smartRelativeVirtualRoot", base.smartRelativeVirtualRoot),
    smartRelativeVirtualRootMode: cfg.get("smartRelativeVirtualRootMode", base.smartRelativeVirtualRootMode),
    smartRelativeIgnoreLastElement: cfg.get("smartRelativeIgnoreLastElement", base.smartRelativeIgnoreLastElement),
    smartRelativeAlwaysIncludeTags: cfg.get("smartRelativeAlwaysIncludeTags", base.smartRelativeAlwaysIncludeTags),
    smartRelativeDontIgnoreAfter: cfg.get("smartRelativeDontIgnoreAfter", base.smartRelativeDontIgnoreAfter),
    smartRelativeLandmarkMode: cfg.get("smartRelativeLandmarkMode", base.smartRelativeLandmarkMode),
    smartRelativeIndentSize: cfg.get("smartRelativeIndentSize", base.smartRelativeIndentSize),

    // relative extras
    relativeMustIncludeTags: cfg.get("relativeMustIncludeTags", base.relativeMustIncludeTags),
    relativeMustIgnoreTags: cfg.get("relativeMustIgnoreTags", base.relativeMustIgnoreTags),
    relativeDontIgnoreAfter: cfg.get("relativeDontIgnoreAfter", base.relativeDontIgnoreAfter),
    relativeNamespacePrefix: cfg.get("relativeNamespacePrefix", base.relativeNamespacePrefix),

    // notification toggle (not declared in package.json by default; add if you want it visible)
    showNotifications: cfg.get("showNotifications", base.showNotifications)
  };
}

function truncate(s, n = 160) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function notifyIfAllowed(message, options = {}) {
  const cfg = getWorkspaceConfig();
  if (!cfg.showNotifications) return;
  // Use info by default; allow override with options.level = 'warn'|'error'
  const level = options.level || "info";
  if (level === "warn") vscode.window.showWarningMessage(message);
  else if (level === "error") vscode.window.showErrorMessage(message);
  else vscode.window.showInformationMessage(message);
}

// helper to build a short sample xpath for messages
function sampleXPathSnippet() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "xml") return null;
  try {
    const cfg = getWorkspaceConfig();
    const xpath = builder.buildXPathRegex(editor.document, editor.selection.active, cfg);
    return xpath ? truncate(xpath, 240) : null;
  } catch (e) {
    // ignore errors in sample creation
    return null;
  }
}

// Generic setter + notification helper
async function setConfigKey(key, value, showNotification = true) {
  const cfg = vscode.workspace.getConfiguration("xmlXpath");
  await cfg.update(key, value, vscode.ConfigurationTarget.Global);
  if (showNotification) {
    const sample = sampleXPathSnippet();
    const msg = `${key} set to ${JSON.stringify(value)}${sample ? " — sample XPath: " + sample : ""}`;
    notifyIfAllowed(msg);
  }
}

// toggle for boolean config keys (returns new value)
async function toggleBoolConfig(key) {
  const cfg = vscode.workspace.getConfiguration("xmlXpath");
  const cur = cfg.get(key);
  await cfg.update(key, !cur, vscode.ConfigurationTarget.Global);
  const sample = sampleXPathSnippet();
  const msg = `${key} toggled → ${!cur}${sample ? " — sample XPath: " + sample : ""}`;
  notifyIfAllowed(msg);
  return !cur;
}

// helpers to reduce repeated registration code
function registerToggle(context, commandId, configKey) {
  context.subscriptions.push(vscode.commands.registerCommand(commandId, async () => {
    await toggleBoolConfig(configKey);
    updateStatusBar(vscode.window.activeTextEditor);
  }));
}

function registerInputCommand(context, commandId, configKey, prompt, hint = "") {
  context.subscriptions.push(vscode.commands.registerCommand(commandId, async () => {
    const cur = vscode.workspace.getConfiguration("xmlXpath").get(configKey) || [];
    const defaultText = Array.isArray(cur) ? cur.join(",") : cur;
    const val = await vscode.window.showInputBox({ prompt, value: defaultText, placeHolder: hint });
    if (val == null) return;
    const out = Array.isArray(cur) ? val.split(",").map(s => s.trim()).filter(Boolean) : val || "";
    await setConfigKey(configKey, out);
    updateStatusBar(vscode.window.activeTextEditor);
  }));
}

function registerSimpleCommand(context, commandId, handler) {
  context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
}

// status bar update logic
async function updateStatusBar(editor) {
  if (!statusBarItem) return;
  if (!editor || !editor.document || editor.document.languageId !== "xml") {
    try { statusBarItem.hide(); } catch (e) { /* ignore */ }
    return;
  }

  try {
    const config = getWorkspaceConfig();
    const xpath = builder.buildXPathRegex(editor.document, editor.selection.active, config);
    if (xpath) {
      const shortText = xpath.length > 80 ? xpath.slice(0, 70) + "…" : xpath;
      statusBarItem.text = `$(search) XPath: ${shortText}`;
      statusBarItem.tooltip = `${truncate(xpath, 1000)}\n\n(click to copy full XPath to clipboard)`;
      statusBarItem.command = "xmlXpath.copyXPath";
      statusBarItem.show();
    } else {
      statusBarItem.text = `$(search) XPath: —`;
      statusBarItem.tooltip = "No XPath available at cursor position";
      statusBarItem.command = undefined;
      statusBarItem.show();
    }
  } catch (e) {
    console.error("Error updating status bar:", e);
    statusBarItem.text = `$(search) XPath: error`;
    statusBarItem.tooltip = "Error generating XPath (see console).";
    statusBarItem.show();
  }
}

// get a tag-name token under cursor (used by several commands)
function getTagNameUnderCursor(editor) {
  if (!editor) return null;
  const pos = editor.selection.active;
  const doc = editor.document;
  const wordRange = doc.getWordRangeAtPosition(pos, /[A-Za-z0-9\-_:.]+/);
  if (!wordRange) return null;
  return doc.getText(wordRange);
}

// copy xpath
async function copyXPathToClipboard(editor, opts = {}) {
  if (!editor) {
    notifyIfAllowed("No active XML editor", { level: "warn" });
    return;
  }
  const config = getWorkspaceConfig();
  const merged = Object.assign({}, config, opts || {});
  const xpath = builder.buildXPathRegex(editor.document, editor.selection.active, merged);
  if (!xpath) {
    notifyIfAllowed("Could not generate XPath at cursor", { level: "warn" });
    return;
  }
  await vscode.env.clipboard.writeText(xpath);
  // richer notification: show full => truncated sample + confirm
  const sample = truncate(xpath, 240);
  notifyIfAllowed(`XPath copied to clipboard: ${sample}`);
}

// copy universal xpath (keeps behavior)
async function copyUniversalXPath(editor) {
  const opts = { useRelativePath: true, includeNamespaces: false };
  await copyXPathToClipboard(editor, opts);
}

// search with xpath (keeps behavior)
async function searchWithXPath(editor) {
  if (!editor) {
    notifyIfAllowed("No active XML editor", { level: "warn" });
    return;
  }
  const config = getWorkspaceConfig();
  const xpath = builder.buildXPathRegex(editor.document, editor.selection.active, config);
  if (!xpath) {
    notifyIfAllowed("Could not generate XPath at cursor", { level: "warn" });
    return;
  }
  // Run find in files with the xpath string
  await vscode.commands.executeCommand("workbench.action.findInFiles", {
    query: xpath,
    triggerSearch: true,
    isRegex: false
  });
}

// activate / deactivate
function activate(context) {
  builder = new XPathBuilder();

  // single status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "xmlXpath.copyXPath";
  context.subscriptions.push(statusBarItem);

  // keep status updated
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((e) => updateStatusBar(e)));
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((e) => updateStatusBar(e.textEditor)));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("xmlXpath")) updateStatusBar(vscode.window.activeTextEditor);
  }));

  // core commands
  registerSimpleCommand(context, "xmlXpath.copyXPath", async () => copyXPathToClipboard(vscode.window.activeTextEditor));
  registerSimpleCommand(context, "xmlXpath.copyUniversalXPath", async () => copyUniversalXPath(vscode.window.activeTextEditor));
  registerSimpleCommand(context, "xmlXpath.searchWithXPath", async () => searchWithXPath(vscode.window.activeTextEditor));

  // parent tag commands
  registerSimpleCommand(context, "xmlXpath.setParent", async () => {
    const val = await vscode.window.showInputBox({ prompt: "Parent tag (leave empty to clear)" });
    await setConfigKey("parentTag", val || null);
    updateStatusBar(vscode.window.activeTextEditor);
  });
  registerSimpleCommand(context, "xmlXpath.clearParent", async () => {
    await setConfigKey("parentTag", null);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  // mode
  registerSimpleCommand(context, "xmlXpath.setMode", async () => {
    const picked = await vscode.window.showQuickPick(
      ["includeIndices: true, includeAttributes: true", "indices only", "attributes only", "none"],
      { placeHolder: "Select XPath generation mode" }
    );
    if (!picked) return;
    let mode;
    switch (picked) {
      case "indices only": mode = { includeIndices: true, includeAttributes: false }; break;
      case "attributes only": mode = { includeIndices: false, includeAttributes: true }; break;
      case "none": mode = { includeIndices: false, includeAttributes: false }; break;
      default: mode = { includeIndices: true, includeAttributes: true };
    }
    await setConfigKey("mode", mode);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  // preferred attributes
  registerSimpleCommand(context, "xmlXpath.setPreferredAttributes", async () => {
    const cur = vscode.workspace.getConfiguration("xmlXpath").get("preferredAttributes") || [];
    const val = await vscode.window.showInputBox({ prompt: "Preferred attributes (comma-separated)", value: cur.join(",") });
    if (val == null) return;
    const arr = val.split(",").map(s => s.trim()).filter(Boolean);
    await setConfigKey("preferredAttributes", arr);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  // boolean toggles (use helper to register)
  const toggles = [
    { cmd: "xmlXpath.toggleDisableLeafIndex", key: "disableLeafIndex" },
    { cmd: "xmlXpath.toggleSkipSingleIndex", key: "skipSingleIndex" },
    { cmd: "xmlXpath.toggleUseXlinkLabelIndex", key: "useXlinkLabelIndex" },
    { cmd: "xmlXpath.toggleParentScopedIndexing", key: "useParentScopedIndices" },
    { cmd: "xmlXpath.toggleIgnoreParentSegment", key: "ignoreParentSegment" },
    { cmd: "xmlXpath.toggleUseRelativePath", key: "useRelativePath" },
    { cmd: "xmlXpath.toggleIncludeNamespaces", key: "includeNamespaces" },
    { cmd: "xmlXpath.toggleIncludeDefaultNamespaces", key: "includeDefaultNamespaces" },
    { cmd: "xmlXpath.toggleUseSmartRelativePath", key: "useSmartRelativePath" },
    { cmd: "xmlXpath.toggleSmartRelativeLandmarkMode", key: "smartRelativeLandmarkMode" },
    { cmd: "xmlXpath.toggleSmartRelativeIgnoreLastElement", key: "smartRelativeIgnoreLastElement" },
    { cmd: "xmlXpath.toggleSmartRelativeSingleLine", key: "smartRelativeSingleLine" },
    { cmd: "xmlXpath.toggleAttributeBasedIndexing", key: "useAttributeBasedIndexing" }
  ];
  toggles.forEach(t => registerToggle(context, t.cmd, t.key));

  // more commands (xlink pattern, predicate template, force [1], etc.)
  registerSimpleCommand(context, "xmlXpath.setXlinkLabelPattern", async () => {
    const cur = vscode.workspace.getConfiguration("xmlXpath").get("xlinkLabelPattern") || { type: "any", pattern: "" };
    const type = await vscode.window.showQuickPick(["any", "startsWith", "contains", "endsWith", "exactPrefix", "regex"], { placeHolder: "Select xlinkLabel pattern type", canPickMany: false });
    if (!type) return;
    const pattern = await vscode.window.showInputBox({ prompt: "Pattern (leave empty for default)", value: cur.pattern || "" });
    if (pattern == null) return;
    await setConfigKey("xlinkLabelPattern", { type, pattern });
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.setTemplate", async () => {
    const cur = vscode.workspace.getConfiguration("xmlXpath").get("predicateTemplate") || "[@{attr1}='{attr1V}']";
    const val = await vscode.window.showInputBox({ prompt: "Predicate template", value: cur });
    if (val == null) return;
    await setConfigKey("predicateTemplate", val);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.setForceIndexOneFor", async () => {
    const cur = vscode.workspace.getConfiguration("xmlXpath").get("forceIndexOneFor") || [];
    const val = await vscode.window.showInputBox({ prompt: "Tags to force [1] (comma-separated)", value: cur.join(",") });
    if (val == null) return;
    const arr = val.split(",").map(s => s.trim()).filter(Boolean);
    await setConfigKey("forceIndexOneFor", arr);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.setExceptionsToIndexOneForcing", async () => {
    const cur = vscode.workspace.getConfiguration("xmlXpath").get("exceptionsToIndexOneForcing") || [];
    const val = await vscode.window.showInputBox({ prompt: "Tags to exclude from forcing [1] (comma-separated)", value: cur.join(",") });
    if (val == null) return;
    const arr = val.split(",").map(s => s.trim()).filter(Boolean);
    await setConfigKey("exceptionsToIndexOneForcing", arr);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.setAttributeBasedIndexingAttribute", async () => {
    const cur = vscode.workspace.getConfiguration("xmlXpath").get("attributeBasedIndexingAttribute") || "";
    const val = await vscode.window.showInputBox({ prompt: "Attribute name to use for attribute-based indexing (leave empty to use preferred attributes)", value: cur });
    if (val == null) return;
    await setConfigKey("attributeBasedIndexingAttribute", val);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.setSmartRelativeNamespacePrefix", async () => {
    const cur = vscode.workspace.getConfiguration("xmlXpath").get("smartRelativeNamespacePrefix") || "d";
    const val = await vscode.window.showInputBox({ prompt: "Smart relative namespace prefix", value: cur });
    if (val == null) return;
    await setConfigKey("smartRelativeNamespacePrefix", val);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.setSmartRelativeSignificantAttributes", async () => {
    const cur = vscode.workspace.getConfiguration("xmlXpath").get("smartRelativeSignificantAttributes") || [];
    const val = await vscode.window.showInputBox({ prompt: "Significant attributes (comma-separated)", value: cur.join(",") });
    if (val == null) return;
    const arr = val.split(",").map(s => s.trim()).filter(Boolean);
    await setConfigKey("smartRelativeSignificantAttributes", arr);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.setSmartRelativeVirtualRoot", async () => {
    const cur = vscode.workspace.getConfiguration("xmlXpath").get("smartRelativeVirtualRoot") || "";
    const val = await vscode.window.showInputBox({ prompt: "Smart relative virtual root tag (leave empty to clear)", value: cur });
    if (val == null) return;
    await setConfigKey("smartRelativeVirtualRoot", val);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.clearSmartRelativeVirtualRoot", async () => {
    await setConfigKey("smartRelativeVirtualRoot", "");
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.toggleSmartRelativeVirtualRootMode", async () => {
    const cfg = vscode.workspace.getConfiguration("xmlXpath");
    const cur = cfg.get("smartRelativeVirtualRootMode") || "include";
    const next = cur === "include" ? "exclude" : "include";
    await cfg.update("smartRelativeVirtualRootMode", next, vscode.ConfigurationTarget.Global);
    notifyIfAllowed(`smartRelativeVirtualRootMode set to ${next}`);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  // addAlwaysIncludeTagFromCursor
  registerSimpleCommand(context, "xmlXpath.addAlwaysIncludeTagFromCursor", async () => {
    const editor = vscode.window.activeTextEditor;
    const tag = getTagNameUnderCursor(editor);
    if (!tag) {
      notifyIfAllowed("No tag under cursor", { level: "warn" });
      return;
    }
    const cfg = vscode.workspace.getConfiguration("xmlXpath");
    const arr = cfg.get("smartRelativeAlwaysIncludeTags") || [];
    if (!arr.includes(tag)) {
      arr.push(tag);
      await cfg.update("smartRelativeAlwaysIncludeTags", arr, vscode.ConfigurationTarget.Global);
      notifyIfAllowed(`Added ${tag} to smartRelativeAlwaysIncludeTags — sample XPath: ${truncate(sampleXPathSnippet() || "", 200)}`);
      updateStatusBar(vscode.window.activeTextEditor);
    } else {
      notifyIfAllowed(`${tag} already present in smartRelativeAlwaysIncludeTags`);
    }
  });

  registerSimpleCommand(context, "xmlXpath.clearAlwaysIncludeTags", async () => {
    await setConfigKey("smartRelativeAlwaysIncludeTags", []);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.setDontIgnoreAfterFromCursor", async () => {
    const editor = vscode.window.activeTextEditor;
    const tag = getTagNameUnderCursor(editor);
    if (!tag) {
      notifyIfAllowed("No tag under cursor", { level: "warn" });
      return;
    }
    await setConfigKey("smartRelativeDontIgnoreAfter", tag);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.clearDontIgnoreAfter", async () => {
    await setConfigKey("smartRelativeDontIgnoreAfter", "");
    updateStatusBar(vscode.window.activeTextEditor);
  });

  // relative-mode setter commands (cleaned)
  registerInputCommand(context, "xmlXpath.setRelativeMustIncludeTags", "relativeMustIncludeTags", "Relative must-include tags (comma-separated)", "e.g. PROPERTY,VALUATION");
  registerInputCommand(context, "xmlXpath.setRelativeMustIgnoreTags", "relativeMustIgnoreTags", "Relative must-ignore tags (comma-separated)", "e.g. IMAGE,NOTE");

  registerSimpleCommand(context, "xmlXpath.setRelativeDontIgnoreAfter", async () => {
    const editor = vscode.window.activeTextEditor;
    const tag = getTagNameUnderCursor(editor);
    if (tag) {
      await setConfigKey("relativeDontIgnoreAfter", tag);
      updateStatusBar(vscode.window.activeTextEditor);
      return;
    }
    const val = await vscode.window.showInputBox({ prompt: "Relative dontIgnoreAfter anchor tag (leave empty to clear)", value: vscode.workspace.getConfiguration("xmlXpath").get("relativeDontIgnoreAfter") || "" });
    if (val == null) return;
    await setConfigKey("relativeDontIgnoreAfter", val);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.clearRelativeDontIgnoreAfter", async () => {
    await setConfigKey("relativeDontIgnoreAfter", "");
    updateStatusBar(vscode.window.activeTextEditor);
  });

  // identifying children commands (cleaned)
  registerSimpleCommand(context, "xmlXpath.addIdentifyingChildFromCursor", async () => {
    const editor = vscode.window.activeTextEditor;
    const tag = getTagNameUnderCursor(editor);
    if (!tag) { notifyIfAllowed("No tag under cursor", { level: "warn" }); return; }
    const cfg = vscode.workspace.getConfiguration("xmlXpath");
    const arr = cfg.get("smartRelativeIdentifyingChildren");
    if (!Array.isArray(arr)) {
      await cfg.update("smartRelativeIdentifyingChildren", [tag], vscode.ConfigurationTarget.Global);
      notifyIfAllowed(`smartRelativeIdentifyingChildren initialized with ${tag}`);
      updateStatusBar(vscode.window.activeTextEditor);
      return;
    }
    if (!arr.includes(tag)) {
      arr.push(tag);
      await cfg.update("smartRelativeIdentifyingChildren", arr, vscode.ConfigurationTarget.Global);
      notifyIfAllowed(`Added ${tag} to smartRelativeIdentifyingChildren`);
      updateStatusBar(vscode.window.activeTextEditor);
    } else {
      notifyIfAllowed(`${tag} already present in smartRelativeIdentifyingChildren`);
    }
  });

  registerSimpleCommand(context, "xmlXpath.removeIdentifyingChildFromCursor", async () => {
    const editor = vscode.window.activeTextEditor;
    const tag = getTagNameUnderCursor(editor);
    if (!tag) { notifyIfAllowed("No tag under cursor", { level: "warn" }); return; }
    const cfg = vscode.workspace.getConfiguration("xmlXpath");
    let arr = cfg.get("smartRelativeIdentifyingChildren");
    if (!Array.isArray(arr) || arr.length === 0) { notifyIfAllowed("No identifying children configured"); return; }
    arr = arr.filter(t => t !== tag);
    await cfg.update("smartRelativeIdentifyingChildren", arr, vscode.ConfigurationTarget.Global);
    notifyIfAllowed(`Removed ${tag} from smartRelativeIdentifyingChildren`);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.clearIdentifyingChildren", async () => {
    await setConfigKey("smartRelativeIdentifyingChildren", []);
    updateStatusBar(vscode.window.activeTextEditor);
  });

  registerSimpleCommand(context, "xmlXpath.listIdentifyingChildren", async () => {
    const arr = vscode.workspace.getConfiguration("xmlXpath").get("smartRelativeIdentifyingChildren");
    if (!Array.isArray(arr) || arr.length === 0) {
      notifyIfAllowed("No identifying children configured");
    } else {
      notifyIfAllowed("Identifying children: " + arr.join(", "));
    }
  });

  // NEW: notifications toggle command (adds convenience)
  registerSimpleCommand(context, "xmlXpath.toggleNotifications", async () => {
    const cfg = vscode.workspace.getConfiguration("xmlXpath");
    const cur = cfg.get("showNotifications", true);
    await cfg.update("showNotifications", !cur, vscode.ConfigurationTarget.Global);
    notifyIfAllowed(`showNotifications set to ${!cur}`);
  });

  // initial status update
  updateStatusBar(vscode.window.activeTextEditor);

  // cleanup on deactivate
  context.subscriptions.push({
    dispose() {
      if (statusBarItem) {
        statusBarItem.dispose();
        statusBarItem = null;
      }
    }
  });
}

function deactivate() {
  if (statusBarItem) statusBarItem.dispose();
}

module.exports = { activate, deactivate };
