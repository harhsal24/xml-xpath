// ========== File: extension.js ==========

const vscode = require("vscode");
const XPathBuilder = require("./XPathBuilder.js");

const CONFIG_SECTION = "xmlXpath";
let statusBarItem;

let lastSearchXPath = "";
let lastSearchResults = [];
let currentSearchIndex = 0;

// Global instance of our pure logic class
const xpathBuilder = new XPathBuilder();

// We override the 'loadConfiguration' method on our instance
// to use the real VS Code API. This is a clean way to inject dependencies.
xpathBuilder.loadConfiguration = function () {
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
    predicateTemplate: cfg.get("predicateTemplate", "[@{attr1}='{attr1V}']"),
    xlinkLabelPattern: cfg.get("xlinkLabelPattern", {
      type: "any",
      pattern: "",
    }),
    forceIndexOneFor: new Set(cfg.get("forceIndexOneFor", [])),
    exceptionsToIndexOneForcing: new Set(
      cfg.get("exceptionsToIndexOneForcing", [])
    ),
    useAttributeBasedIndexing: cfg.get("useAttributeBasedIndexing", false),
    attributeBasedIndexingAttribute: cfg.get(
      "attributeBasedIndexingAttribute",
      ""
    ),
    useRelativePath: cfg.get("useRelativePath", false),
    includeNamespaces: cfg.get("includeNamespaces", false),
    includeDefaultNamespaces: cfg.get("includeDefaultNamespaces", false),
    useSmartRelativePath: cfg.get("useSmartRelativePath", false),
    smartRelativeNamespacePrefix: cfg.get("smartRelativeNamespacePrefix", "d"),
    smartRelativeSignificantAttributes: cfg.get(
      "smartRelativeSignificantAttributes",
      []
    ),
    smartRelativeIdentifyingChildren: cfg.get(
      "smartRelativeIdentifyingChildren",
      []
    ),
    smartRelativeIgnoreLastElement: cfg.get(
      "smartRelativeIgnoreLastElement",
      false
    ),
    smartRelativeSingleLine: cfg.get("smartRelativeSingleLine", false),
    smartRelativeVirtualRoot: cfg.get("smartRelativeVirtualRoot", ""),
    smartRelativeVirtualRootMode: cfg.get(
      "smartRelativeVirtualRootMode",
      "include"
    ),
    // NEW: landmark mode setting
    smartRelativeLandmarkMode: cfg.get("smartRelativeLandmarkMode", true),
    smartRelativeAlwaysIncludeTags: cfg.get("smartRelativeAlwaysIncludeTags", []),
    smartRelativeDontIgnoreAfter: cfg.get("smartRelativeDontIgnoreAfter", ""),
  };
};

function activate(context) {
  try {
    console.log("XML XPath extension is activating...");

    statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    statusBarItem.command = "xmlXpath.copyXPath";
    context.subscriptions.push(statusBarItem);

    registerCommands(context);

    const debouncedUpdate = debounce(update, 150);
    context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection(debouncedUpdate)
    );
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(update));

    update();

    console.log("XML XPath extension activated successfully");
  } catch (error) {
    console.error("Error activating XML XPath extension:", error);
    vscode.window.showErrorMessage(
      `Failed to activate XML XPath: ${error.message}`
    );
  }
}

function registerCommands(context) {
  const commands = {
    "xmlXpath.setParent": setParentTag,
    "xmlXpath.clearParent": clearParentTag,
    "xmlXpath.setMode": setMode,
    "xmlXpath.setPreferredAttributes": () =>
      updateConfig(
        "preferredAttributes",
        "Preferred attributes (comma-separated)",
        (val) =>
          val
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
      ),
    "xmlXpath.setIgnoreIndexTags": () =>
      updateConfig(
        "ignoreIndexTags",
        "Tags to ignore index [1] (comma-separated)",
        (val) =>
          val
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
      ),
    "xmlXpath.copyXPath": copyXPath,
    "xmlXpath.copyUniversalXPath": copyUniversalXPath,
    "xmlXpath.toggleDisableLeafIndex": () =>
      toggleConfig("disableLeafIndex", "Disable Leaf Index"),
    "xmlXpath.toggleSkipSingleIndex": () =>
      toggleConfig("skipSingleIndex", "Skip Index [1]"),
    "xmlXpath.toggleUseXlinkLabelIndex": () =>
      toggleConfig("useXlinkLabelIndex", "Use xlink:label Index"),
    "xmlXpath.toggleParentScopedIndexing": () =>
      toggleConfig("useParentScopedIndices", "Parent-Scoped Indexing"),
    "xmlXpath.toggleIgnoreParentSegment": () =>
      toggleConfig("ignoreParentSegment", "Ignore Parent Segment"),
    "xmlXpath.setTemplate": setPredicateTemplate,
    "xmlXpath.setXlinkLabelPattern": setXlinkLabelPattern,
    "xmlXpath.searchWithXPath": searchWithXPath,
    "xmlXpath.setForceIndexOneFor": () =>
      updateConfig(
        "forceIndexOneFor",
        "Tags to force index [1] (comma-separated, e.g., SECTION,PARAGRAPH)",
        (val) =>
          val
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
      ),
    "xmlXpath.setExceptionsToIndexOneForcing": () =>
      updateConfig(
        "exceptionsToIndexOneForcing",
        "Tags that are exceptions to force index [1] (comma-separated, e.g., SUB_SECTION)",
        (val) =>
          val
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
      ),
    "xmlXpath.toggleAttributeBasedIndexing": () =>
      toggleConfig("useAttributeBasedIndexing", "Attribute-Based Indexing"),
    "xmlXpath.setAttributeBasedIndexingAttribute":
      setAttributeBasedIndexingAttribute,
    "xmlXpath.toggleUseRelativePath": toggleUseRelativePath,
    "xmlXpath.toggleIncludeNamespaces": toggleIncludeNamespaces,
    "xmlXpath.toggleIncludeDefaultNamespaces": toggleIncludeDefaultNamespaces,
    "xmlXpath.toggleUseSmartRelativePath": toggleUseSmartRelativePath,
    "xmlXpath.setSmartRelativeNamespacePrefix": setSmartRelativeNamespacePrefix,
    "xmlXpath.setSmartRelativeSignificantAttributes": setSmartRelativeSignificantAttributes,
    "xmlXpath.toggleSmartRelativeIgnoreLastElement": toggleSmartRelativeIgnoreLastElement,
    "xmlXpath.toggleSmartRelativeSingleLine": toggleSmartRelativeSingleLine,
    "xmlXpath.setSmartRelativeVirtualRoot": setSmartRelativeVirtualRoot,
    "xmlXpath.toggleSmartRelativeVirtualRootMode": toggleSmartRelativeVirtualRootMode,
    "xmlXpath.clearSmartRelativeVirtualRoot": clearSmartRelativeVirtualRoot,
    "xmlXpath.addAlwaysIncludeTagFromCursor": addAlwaysIncludeTagFromCursor,
    "xmlXpath.clearAlwaysIncludeTags": clearAlwaysIncludeTagsCommand,
    "xmlXpath.setDontIgnoreAfterFromCursor": setDontIgnoreAfterFromCursor,
    "xmlXpath.clearDontIgnoreAfter": clearDontIgnoreAfterCommand,
    // NEW: toggle for landmark mode
    "xmlXpath.toggleSmartRelativeLandmarkMode": toggleSmartRelativeLandmarkMode,
  };

  for (const [name, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
  }
}

// Helper: get the tag name under the cursor (returns '' if none)
async function getTagUnderCursor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) return "";

  try {
    const xml = editor.document.getText();
    const offset = editor.document.offsetAt(editor.selection.active);
    const config = xpathBuilder.loadConfiguration();
    const events = xpathBuilder.tokenizeXML(xml, config);
    if (!events) return "";

    const stackResult = xpathBuilder.buildElementStack(events, offset, config);
    if (stackResult && stackResult.stack.length > 0) {
      // return the current element's tag name (closest)
      return stackResult.stack[stackResult.stack.length - 1].tag || "";
    }
  } catch (e) {
    console.error("Error in getTagUnderCursor:", e);
  }
  return "";
}

// Command: add tag under cursor (or ask) to smartRelativeAlwaysIncludeTags and persist
async function addAlwaysIncludeTagFromCursor() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("smartRelativeAlwaysIncludeTags", []);
  let tag = await getTagUnderCursor();

  // If nothing sensible found, prompt user
  if (!tag) {
    tag = await vscode.window.showInputBox({
      prompt: "Tag to always include in Smart Relative mode",
      placeHolder: "e.g., a, link, item",
      validateInput: (v) => {
        if (!v) return "Tag cannot be empty";
        if (!/^[A-Za-z_][A-Za-z0-9_:\\-\\.]*$/.test(v)) return "Invalid XML tag name";
        return null;
      },
    });
    if (!tag) return;
  } else {
    // confirm quick-add
    const confirm = await vscode.window.showQuickPick(["Yes", "No"], {
      placeHolder: `Add '${tag}' to Smart Relative always-include list?`
    });
    if (confirm !== "Yes") return;
  }

  tag = tag.trim();
  const updated = Array.isArray(current) ? [...current] : [];
  if (!updated.includes(tag)) {
    updated.push(tag);
    await cfg.update("smartRelativeAlwaysIncludeTags", updated, vscode.ConfigurationTarget.Global);

    // No runtime changes necessary on xpathBuilder — it reads config in loadConfiguration()
    vscode.window.showInformationMessage(`Added '${tag}' to Smart Relative always-include list`);
    update();
  } else {
    vscode.window.showInformationMessage(`'${tag}' is already in the always-include list`);
  }
}

// Command: clear always-include list
async function clearAlwaysIncludeTagsCommand() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await cfg.update("smartRelativeAlwaysIncludeTags", [], vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage("Smart Relative always-include list cleared");
  update();
}

// Command: set dont-ignore-after from cursor (or prompt), and persist
async function setDontIgnoreAfterFromCursor() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("smartRelativeDontIgnoreAfter", "");
  let tag = await getTagUnderCursor();

  if (!tag) {
    tag = await vscode.window.showInputBox({
      prompt: "Do not ignore any tag after this element (anchor). Enter tag name",
      placeHolder: "e.g., SECTION, ITEM, PROPERTY",
      value: current || "",
      validateInput: (v) => {
        if (!v) return "Tag cannot be empty";
        if (!/^[A-Za-z_][A-Za-z0-9_:\\-\\.]*$/.test(v)) return "Invalid XML tag name";
        return null;
      },
    });
    if (!tag) return;
  } else {
    const confirm = await vscode.window.showQuickPick(["Yes","No"], {
      placeHolder: `Set 'don't ignore any tag after' anchor to '${tag}'?`
    });
    if (confirm !== "Yes") return;
  }

  tag = tag.trim();
  await cfg.update("smartRelativeDontIgnoreAfter", tag, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Smart Relative: will not ignore tags after '${tag}'`);
  update();
}

// Command: clear dont-ignore-after anchor
async function clearDontIgnoreAfterCommand() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await cfg.update("smartRelativeDontIgnoreAfter", "", vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage("Smart Relative 'dont-ignore-after' anchor cleared");
  update();
}

// Add the command functions:
async function setSmartRelativeVirtualRoot() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("smartRelativeVirtualRoot", "");

  // Get current element under cursor as suggestion
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
          // Suggest a parent element as virtual root
          if (stackResult.stack.length > 1) {
            tagUnderCursor = stackResult.stack[stackResult.stack.length - 2].tag;
          }
        }
      }
    } catch (error) {
      console.error("Error getting tag under cursor:", error);
    }
  }

  const value = await vscode.window.showInputBox({
    prompt: "Virtual root element for smart relative XPath",
    value: tagUnderCursor || current,
    placeHolder: "e.g., PROPERTY, VALUATION, DOCUMENT, SERVICE",
    validateInput: (value) => {
      if (value && !/^[a-zA-Z][a-zA-Z0-9_\-:.]*$/.test(value)) {
        return "Must be a valid XML element name";
      }
      return null;
    }
  });

  if (value !== undefined) {
    await cfg.update("smartRelativeVirtualRoot", value.trim(), vscode.ConfigurationTarget.Global);
    update();

    if (value.trim()) {
      vscode.window.showInformationMessage(`Virtual root set to: ${value.trim()}`);
    } else {
      vscode.window.showInformationMessage("Virtual root cleared - using document root");
    }
  }
}

async function toggleSmartRelativeVirtualRootMode() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("smartRelativeVirtualRootMode", "include");
  const newMode = current === "include" ? "exclude" : "include";

  await cfg.update("smartRelativeVirtualRootMode", newMode, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Virtual Root Mode: ${newMode.toUpperCase()}`);
  update();
}

async function clearSmartRelativeVirtualRoot() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await cfg.update("smartRelativeVirtualRoot", "", vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage("Virtual root cleared");
  update();
}

// Add the toggle functions:
async function toggleSmartRelativeSingleLine() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("smartRelativeSingleLine", false);
  await cfg.update("smartRelativeSingleLine", !current, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Smart Relative Single Line: ${!current ? "ON" : "OFF"}`);
  update();
}

async function toggleSmartRelativeIgnoreLastElement() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("smartRelativeIgnoreLastElement", false);
  await cfg.update("smartRelativeIgnoreLastElement", !current, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Smart Relative Ignore Last Element: ${!current ? "ON" : "OFF"}`);
  update();
}

// NEW: Toggle landmark mode for smart relative
async function toggleSmartRelativeLandmarkMode() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("smartRelativeLandmarkMode", true);
  await cfg.update("smartRelativeLandmarkMode", !current, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Smart Relative Landmark Mode: ${!current ? "ON" : "OFF"}`);
  update();
}

// NEW: Toggle smart relative path
async function toggleUseSmartRelativePath() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("useSmartRelativePath", false);
  await cfg.update("useSmartRelativePath", !current, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Smart Relative Path: ${!current ? "ON" : "OFF"}`);
  update();
}

// NEW: Set smart relative namespace prefix
async function setSmartRelativeNamespacePrefix() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("smartRelativeNamespacePrefix", "d");

  const value = await vscode.window.showInputBox({
    prompt: "Namespace prefix for smart relative XPath",
    value: current,
    placeHolder: "e.g., d, ns, app",
    validateInput: (value) => {
      if (!value) return "Prefix cannot be empty";
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(value)) {
        return "Prefix must be a valid XML namespace prefix";
      }
      return null;
    }
  });

  if (value) {
    await cfg.update("smartRelativeNamespacePrefix", value, vscode.ConfigurationTarget.Global);
    update();
    vscode.window.showInformationMessage(`Smart relative prefix set to: ${value}`);
  }
}

async function setSmartRelativeSignificantAttributes() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("smartRelativeSignificantAttributes", ["ValuationUseType", "id", "type", "name"]);

  const value = await vscode.window.showInputBox({
    prompt: "Significant attributes for smart relative XPath (comma-separated)",
    value: Array.isArray(current) ? current.join(", ") : String(current),
    placeHolder: "ValuationUseType, id, type, name"
  });

  if (value !== undefined) {
    const attributes = value.split(",").map(s => s.trim()).filter(Boolean);
    await cfg.update("smartRelativeSignificantAttributes", attributes, vscode.ConfigurationTarget.Global);
    update();
    vscode.window.showInformationMessage(`Significant attributes set to: ${attributes.join(", ")}`);
  }
}

// NEW: Toggle relative path
async function toggleUseRelativePath() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("useRelativePath", false);
  await cfg.update("useRelativePath", !current, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Use Relative Path: ${!current ? "ON" : "OFF"}`);
  update();
}

// NEW: Toggle include namespaces
async function toggleIncludeNamespaces() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("includeNamespaces", false);
  await cfg.update("includeNamespaces", !current, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Include Namespaces: ${!current ? "ON" : "OFF"}`);
  update();
}

// NEW: Toggle include default namespaces
async function toggleIncludeDefaultNamespaces() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("includeDefaultNamespaces", false);
  await cfg.update("includeDefaultNamespaces", !current, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Include Default Namespaces: ${!current ? "ON" : "OFF"}`);
  update();
}

async function setAttributeBasedIndexingAttribute() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("attributeBasedIndexingAttribute", "");
  const preferredAttrs = cfg.get("preferredAttributes", []);

  // Provide quick pick with preferred attributes
  const items = preferredAttrs.map((attr) => ({
    label: attr,
    description: "Preferred attribute",
  }));
  items.push({
    label: "Custom...",
    description: "Enter custom attribute name",
  });

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Select attribute for indexing",
  });

  if (!pick) return;

  let value = pick.label;
  if (value === "Custom...") {
    value = await vscode.window.showInputBox({
      prompt: "Attribute name for attribute-based indexing",
      value: current,
      placeHolder: "e.g., ValuationType, type, name",
    });
  }

  if (value) {
    await cfg.update(
      "attributeBasedIndexingAttribute",
      value,
      vscode.ConfigurationTarget.Global
    );
    update();
    vscode.window.showInformationMessage(`Attribute-based indexing will use: ${value}`);
  }
}

// Function to find element by XPath
async function findElementByXPath(editor, xpath) {
  const xml = editor.document.getText();
  const config = xpathBuilder.loadConfiguration();

  // Parse the XPath into segments
  const segments = parseXPath(xpath);
  if (!segments || segments.length === 0) {
    throw new Error("Invalid XPath format");
  }

  // Tokenize the XML with configuration
  const events = xpathBuilder.tokenizeXML(xml, config);
  if (!events) {
    throw new Error("Failed to parse XML");
  }

  // Search for matching element with configuration
  return searchForElement(events, segments, xml, config);
}

const REGEX_PATTERNS = {
  predicate: /\[([^\]]+)\]/g,
  position: /^\d+$/,
  attribute: /^@?([^=\s]+)\s*=\s*['"]([^'"]*)['"]/,
  contains: new RegExp(
    `contains\\s*\\(\\s*@([^,)]+)\\s*,\\s*['"]([^'"]+)['"]\\s*\\)`.replace(
      /\s+|#.*/g,
      ""
    ),
    ""
  ),
  endOfLine: new RegExp(`test$`),
  dollarAmount: new RegExp(`\\$(\\d+)`.replace(/\s+|#.*/g, "")),
  text: /text\(\)\s*=\s*['"]([^'"]+)['"]/,
  positionFunc: /position\(\)\s*=\s*(\d+)/,
};

function parseXPath(xpath) {
  // Remove leading slash and split by /
  if (!xpath || !xpath.startsWith("/")) return [];
  const parts = xpath.substring(1).split("/");
  const segments = [];

  for (const part of parts) {
    const bracketIndex = part.indexOf("[");
    let tagName, predicatesPart;
    if (bracketIndex === -1) {
      tagName = part;
      predicatesPart = "";
    } else {
      tagName = part.substring(0, bracketIndex);
      predicatesPart = part.substring(bracketIndex);
    }

    const segment = { tagName, predicates: [] };

    if (predicatesPart) {
      const predicateRegex = /\[([^\]]+)\]/g;
      let predicateMatch;
      while ((predicateMatch = predicateRegex.exec(predicatesPart)) !== null) {
        const predContent = predicateMatch[1].trim();

        if (/^\d+$/.test(predContent)) {
          segment.predicates.push({
            type: "position",
            value: parseInt(predContent, 10),
          });
        } else if (predContent.includes("=")) {
          const attrMatch = predContent.match(/^@?([^=\s]+)\s*=\s*['"]([^'"]*)['"]/);
          if (attrMatch) {
            segment.predicates.push({
              type: "attribute",
              name: attrMatch[1],
              value: attrMatch[2],
            });
          } else {
            segment.predicates.push({ type: "other", value: predContent });
          }
        } else if (predContent.startsWith("contains")) {
          const containsMatch = predContent.match(/contains\s*\(\s*@([^,)]+),\s*['"]([^'"]+)['"]\s*\)/);
          if (containsMatch) {
            segment.predicates.push({
              type: "contains",
              target: containsMatch[1],
              value: containsMatch[2],
            });
          } else {
            segment.predicates.push({ type: "other", value: predContent });
          }
        } else if (predContent.startsWith("text()")) {
          const textMatch = predContent.match(/text\(\)\s*=\s*['"]([^'"]+)['"]/);
          if (textMatch) {
            segment.predicates.push({ type: "text", value: textMatch[1] });
          } else {
            segment.predicates.push({ type: "other", value: predContent });
          }
        } else if (predContent.startsWith("position()")) {
          const posMatch = predContent.match(/position\(\)\s*=\s*(\d+)/);
          if (posMatch) {
            segment.predicates.push({ type: "position", value: parseInt(posMatch[1], 10) });
          } else {
            segment.predicates.push({ type: "other", value: predContent });
          }
        } else if (predContent === "last()") {
          segment.predicates.push({ type: "last" });
        } else {
          segment.predicates.push({ type: "other", value: predContent });
        }
      }
    }

    segments.push(segment);
  }

  return segments;
}

async function searchWithXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) {
    vscode.window.showWarningMessage("Please open an XML file to search.");
    return;
  }

  // Get XPath from clipboard or prompt
  let xpath = await vscode.env.clipboard.readText();

  // If clipboard doesn't contain a potential XPath, prompt user
  if (!xpath || !xpath.startsWith("/")) {
    xpath = await vscode.window.showInputBox({
      prompt: "Enter XPath to search",
      placeHolder: "/root/element[@id='example']",
      value: xpath || "",
      validateInput: (value) => {
        if (!value) return "XPath cannot be empty";
        if (!value.startsWith("/")) return "XPath must start with /";
        return null;
      },
    });

    if (!xpath) return;
  }

  try {
    const result = await findElementByXPath(editor, xpath);

    if (result) {
      // Move cursor to the found element
      const position = editor.document.positionAt(result.startOffset);
      const endPosition = editor.document.positionAt(result.endOffset);

      // Select the element range
      editor.selection = new vscode.Selection(position, endPosition);
      editor.revealRange(
        new vscode.Range(position, endPosition),
        vscode.TextEditorRevealType.InCenter
      );

      // Show appropriate message based on whether it's a full or partial match
      if (result.isPartial) {
        // Build partial matched path string for display
        const segments = parseXPath(xpath);
        const matchedPath = segments
          .slice(0, result.matchedDepth)
          .map((seg) => {
            let path = seg.tagName;
            seg.predicates.forEach((pred) => {
              if (pred.type === "position") {
                path += `[${pred.value}]`;
              } else if (pred.type === "attribute") {
                path += `[@${pred.name}='${pred.value}']`;
              }
            });
            return path;
          })
          .join("/");

        vscode.window.showWarningMessage(
          `Partial match found at depth ${result.matchedDepth}/${result.totalDepth}. ` +
            `Found: /${matchedPath} at line ${position.line + 1}`
        );
      } else {
        vscode.window.showInformationMessage(
          `Found: ${result.tagName} at line ${position.line + 1}`
        );
      }
    } else {
      vscode.window.showWarningMessage(`XPath not found: ${xpath}`);
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Invalid XPath or error: ${error.message}`);
  }
}

async function copyUniversalXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) return;

  try {
    // Save current configuration loader function
    const originalLoader = xpathBuilder.loadConfiguration;

    // Override with universal settings - preserve attribute-based indexing settings
    const currentConfig = originalLoader();
    xpathBuilder.loadConfiguration = function () {
      return {
        parentTag: null,
        mode: { includeIndices: true, includeAttributes: true },
        preferredAttributes: currentConfig.preferredAttributes || [],
        ignoreTags: new Set(),
        disableLeafIndex: false,
        skipSingleIndex: false,
        useXlinkLabelIndex: false,
        useParentScopedIndices: false,
        ignoreParentSegment: false,
        predicateTemplate: "[@{attr1}='{attr1V}']",
        xlinkLabelPattern: { type: "any", pattern: "" },
        forceIndexOneFor: new Set(),
        exceptionsToIndexOneForcing: new Set(),
        useAttributeBasedIndexing: currentConfig.useAttributeBasedIndexing,
        attributeBasedIndexingAttribute: currentConfig.attributeBasedIndexingAttribute,
      };
    };

    // Generate XPath with universal settings
    const xpath = xpathBuilder.buildXPathRegex(editor.document, editor.selection.active);

    // Restore original configuration loader
    xpathBuilder.loadConfiguration = originalLoader;

    if (xpath) {
      await vscode.env.clipboard.writeText(xpath);
      vscode.window.showInformationMessage(`Copied universal XPath: ${xpath}`);
    }
  } catch (error) {
    console.error("Error copying universal XPath:", error);
    vscode.window.showErrorMessage("Could not compute XPath.");
  }
}

// 1. Fix the searchForElement function to properly handle attribute-based indexing
function searchForElement(events, xpathSegments, xml, config) {
  const stack = [];
  let bestMatch = null;
  let maxMatchedDepth = 0;

  // Initialize counters exactly like in buildElementStack
  const counters = config.useParentScopedIndices ? {} : [];
  const attributeCounters = {};

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.type === "open") {
      const depth = stack.length;
      let idx;

      // Determine which attribute to use for indexing (from buildElementStack logic)
      let indexingAttribute = null;
      let indexingValue = null;

      if (config.useAttributeBasedIndexing) {
        if (config.preferredAttributes && config.preferredAttributes.length > 0) {
          for (const attr of config.preferredAttributes) {
            if (event.attrs && event.attrs[attr]) {
              indexingAttribute = attr;
              indexingValue = event.attrs[attr];
              break;
            }
          }
        }
        if (!indexingAttribute && config.attributeBasedIndexingAttribute) {
          if (event.attrs && event.attrs[config.attributeBasedIndexingAttribute]) {
            indexingAttribute = config.attributeBasedIndexingAttribute;
            indexingValue = event.attrs[config.attributeBasedIndexingAttribute];
          }
        }
      }

      // Calculate index based on mode (matching buildElementStack exactly)
      if (config.useAttributeBasedIndexing && indexingAttribute && indexingValue) {
        const key = `${depth}-${event.tag}-${indexingAttribute}-${indexingValue}`;
        if (!attributeCounters[key]) attributeCounters[key] = 0;
        attributeCounters[key]++;
        idx = attributeCounters[key];
      } else if (config.useParentScopedIndices) {
        const parentPath = stack.map((e) => `${e.tag}[${e.index}]`).join("/");
        if (!counters[parentPath]) counters[parentPath] = {};
        counters[parentPath][event.tag] =
          (counters[parentPath][event.tag] || 0) + 1;
        idx = counters[parentPath][event.tag];
      } else {
        if (!counters[depth]) counters[depth] = {};
        counters[depth][event.tag] = (counters[depth][event.tag] || 0) + 1;
        idx = counters[depth][event.tag];
      }

      // Collect ALL preferred attributes for this element
      const preferredAttrs = [];
      if (event.attrs && config.preferredAttributes) {
        for (const attrName of config.preferredAttributes) {
          if (event.attrs[attrName]) {
            preferredAttrs.push({
              name: attrName,
              value: event.attrs[attrName],
            });
          }
        }
      }

      // Add to stack with all the same properties as buildElementStack
      stack.push({
        tag: event.tag,
        idx: idx,
        index: idx,
        customIndex: event.customIndex,
        customIndexRaw: event.customIndexRaw,
        attrs: event.attrs,
        indexingAttribute: indexingAttribute,
        indexingValue: indexingValue,
        preferredAttrs: preferredAttrs,
        startOffset: event.pos,
        eventIndex: i,
      });

      // Rest of the matching logic...
      const matchResult = checkFullMatchWithConfig(stack, xpathSegments, config);

      // Update best match if deeper match found
      if (matchResult.depth > maxMatchedDepth) {
        maxMatchedDepth = matchResult.depth;

        const matchedElementIndex = matchResult.depth - 1;
        if (matchedElementIndex >= 0 && matchedElementIndex < stack.length) {
          const matchedElement = stack[matchedElementIndex];

          let endOffset =
            matchedElement.startOffset + matchedElement.tag.length + 2;
          let openCount = 1;

          for (let j = matchedElement.eventIndex + 1; j < events.length; j++) {
            if (events[j].tag === matchedElement.tag) {
              if (events[j].type === "open") {
                openCount++;
              } else if (events[j].type === "close") {
                openCount--;
                if (openCount === 0) {
                  endOffset = events[j].pos + events[j].tag.length + 3;
                  break;
                }
              }
            }
          }

          bestMatch = {
            tagName: matchedElement.tag,
            startOffset: matchedElement.startOffset,
            endOffset: endOffset,
            attrs: matchedElement.attrs,
            matchedDepth: matchResult.depth,
            totalDepth: xpathSegments.length,
            isPartial: !matchResult.isFullMatch,
          };
        }
      }

      // Check for full match
      if (matchResult.isFullMatch) {
        const lastElement = stack[stack.length - 1];
        let endOffset = lastElement.startOffset + lastElement.tag.length + 2;
        let openCount = 1;

        for (let j = i + 1; j < events.length; j++) {
          if (events[j].tag === lastElement.tag) {
            if (events[j].type === "open") {
              openCount++;
            } else if (events[j].type === "close") {
              openCount--;
              if (openCount === 0) {
                endOffset = events[j].pos + events[j].tag.length + 3;
                break;
              }
            }
          }
        }

        return {
          tagName: lastElement.tag,
          startOffset: lastElement.startOffset,
          endOffset: endOffset,
          attrs: lastElement.attrs,
          matchedDepth: xpathSegments.length,
          totalDepth: xpathSegments.length,
          isPartial: false,
        };
      }
    } else if (event.type === "close") {
      if (stack.length > 0 && stack[stack.length - 1].tag === event.tag) {
        stack.pop();
      }
    }
  }

  return bestMatch;
}

// Helper function that considers configuration
function checkFullMatchWithConfig(stack, xpathSegments, config) {
  let depth = 0;
  const matchedPath = [];

  for (let i = 0; i < Math.min(stack.length, xpathSegments.length); i++) {
    const stackItem = stack[i];
    const xpathSegment = xpathSegments[i];

    // Check tag name
    if (stackItem.tag !== xpathSegment.tagName) {
      break;
    }

    // Check all predicates
    let allPredicatesMatch = true;
    let pathPart = stackItem.tag;

    for (const predicate of xpathSegment.predicates) {
      if (predicate.type === "position") {
        // Handle position based on configuration
        let expectedIndex = predicate.value;
        let actualIndex = stackItem.index;

        if (config.useXlinkLabelIndex && stackItem.customIndex !== undefined) {
          actualIndex = stackItem.customIndex;
        }

        if (config.useAttributeBasedIndexing && config.attributeBasedIndexingAttribute && stackItem.attrs && stackItem.attrs[config.attributeBasedIndexingAttribute]) {
          // The stackItem.index already considers attribute-based indexing in searchForElement
          // so we can compare directly
          if (actualIndex !== expectedIndex) {
            allPredicatesMatch = false;
            break;
          }
        } else {
          if (actualIndex !== expectedIndex) {
            allPredicatesMatch = false;
            break;
          }
        }
        pathPart += `[${predicate.value}]`;
      } else if (predicate.type === "attribute") {
        if (!stackItem.attrs || stackItem.attrs[predicate.name] !== predicate.value) {
          allPredicatesMatch = false;
          break;
        }
        pathPart += `[@${predicate.name}='${predicate.value}']`;
      } else if (predicate.type === "contains") {
        if (!stackItem.attrs || !stackItem.attrs[predicate.target] || !stackItem.attrs[predicate.target].includes(predicate.value)) {
          allPredicatesMatch = false;
          break;
        }
      } else if (predicate.type === "text") {
        // For text predicates we'd need to inspect child text nodes — skip for now or implement if needed
        allPredicatesMatch = false;
        break;
      } else if (predicate.type === "last") {
        // Handling last() would require counting siblings — not implemented in searchForElement
        allPredicatesMatch = false;
        break;
      }
    }

    if (!allPredicatesMatch) {
      break;
    }

    matchedPath.push(pathPart);
    depth++;
  }

  return {
    depth: depth,
    isFullMatch: depth === xpathSegments.length,
    matchedPath: "/" + matchedPath.join("/"),
  };
}

function matchesXPath(stack, xpathSegments) {
  if (stack.length !== xpathSegments.length) return false;

  for (let i = 0; i < stack.length; i++) {
    const stackItem = stack[i];
    const xpathSegment = xpathSegments[i];

    if (stackItem.tag !== xpathSegment.tagName) return false;

    for (const predicate of xpathSegment.predicates) {
      if (predicate.type === "position") {
        if (stackItem.index !== predicate.value) {
          return false;
        }
      } else if (predicate.type === "attribute") {
        if (!stackItem.attrs || !stackItem.attrs.hasOwnProperty(predicate.name) || stackItem.attrs[predicate.name] !== predicate.value) {
          return false;
        }
      }
    }
  }

  return true;
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

      const events = xpathBuilder.tokenizeXML(xml, config);
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
    value: tagUnderCursor || currentValue,
    placeHolder: currentValue || tagUnderCursor || "e.g., section, div, body",
  });

  if (value !== undefined) {
    await cfg.update("parentTag", value || null, vscode.ConfigurationTarget.Global);
    update();

    if (value) {
      vscode.window.showInformationMessage(
        `Parent tag set to: ${value}. XPaths will now be relative to <${value}>`
      );
    }
  }
}

async function setPredicateTemplate() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const currentValue = cfg.get("predicateTemplate", "[@{attr1}='{attr1V}']");

  const examples = [
    { label: "Default: [@attr='value']", value: "[@{attr1}='{attr1V}']" },
    { label: "Hash: [#attr='value']", value: "[#{attr1}='{attr1V}']" },
    { label: "Dot: [.attr='value']", value: "[.{attr1}='{attr1V}']" },
    { label: "Colon: [attr:value='value']", value: "[{attr1}:value='{attr1V}']" },
    { label: "Contains: [contains(@attr, 'value')]", value: "[contains({at}{attr1}, '{attr1V}')]" },
    { label: "Position: [@attr='value'][position()=n]", value: "[@{attr1}='{attr1V}'][position()={idx}]" },
    { label: "Text: [text()='value']", value: "[text()='{attr1V}']" },
    { label: "Custom...", value: "__custom__" },
  ];

  const pick = await vscode.window.showQuickPick(examples, {
    placeHolder: "Select a predicate template or choose Custom",
  });

  if (!pick) return;

  let value = pick.value;
  if (value === "__custom__") {
    value = await vscode.window.showInputBox({
      prompt: "Predicate template. Tokens: {at}=@, {attr1}, {attr1V}, {tag}, {idx}, {xllv}, {xllvI}",
      value: currentValue,
      placeHolder: "[@{attr1}='{attr1V}']",
      validateInput: (value) => {
        if (!value) return "Template cannot be empty";
        if (!value.includes("{attr1}") && !value.includes("{attr1V}")) {
          return "Template should include {attr1} or {attr1V} token";
        }
        return null;
      },
    });
  }

  if (value) {
    await cfg.update("predicateTemplate", value, vscode.ConfigurationTarget.Global);
    update();

    const example = value
      .replace(/{at}/g, "@")
      .replace(/{attr1}/g, "id")
      .replace(/{attr1V}/g, "example")
      .replace(/{tag}/g, "div")
      .replace(/{idx}/g, "1");
    vscode.window.showInformationMessage(`Template set. Example: ${example}`);
  }
}

async function setXlinkLabelPattern() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const currentPattern = cfg.get("xlinkLabelPattern", { type: "any", pattern: "" });

  const patternTypes = [
    { label: "Any number (default)", description: "Extract any number found in xlink:label", value: { type: "any", pattern: "" } },
    { label: "Starts with pattern", description: "e.g., 'order_' to match order_123", value: { type: "startsWith", pattern: "__input__" } },
    { label: "Contains pattern", description: "e.g., 'item' to match item123 or myitem456", value: { type: "contains", pattern: "__input__" } },
    { label: "Ends with pattern", description: "e.g., '_id' to match user_id, order_id", value: { type: "endsWith", pattern: "__input__" } },
    { label: "Regex pattern", description: "Custom regex to extract number", value: { type: "regex", pattern: "__input__" } },
    { label: "Exact prefix", description: "e.g., 'ID:' to match ID:123 exactly", value: { type: "exactPrefix", pattern: "__input__" } },
  ];

  const pick = await vscode.window.showQuickPick(patternTypes, { placeHolder: "Select how to match xlink:label values" });
  if (!pick) return;

  let pattern = pick.value.pattern;
  if (pattern === "__input__") {
    const examples = {
      startsWith: "e.g., 'order_' for order_123",
      contains: "e.g., 'item' for myitem456",
      endsWith: "e.g., '_id' for user_id",
      regex: "e.g., 'ID:(\\d+)' for ID:123",
      exactPrefix: "e.g., 'REF-' for REF-789",
    };

    pattern = await vscode.window.showInputBox({
      prompt: `Enter the ${pick.value.type} pattern`,
      placeHolder: examples[pick.value.type] || "Enter pattern",
      value: currentPattern.type === pick.value.type ? currentPattern.pattern : "",
    });

    if (!pattern) return;
  }

  const newPattern = { type: pick.value.type, pattern };
  await cfg.update("xlinkLabelPattern", newPattern, vscode.ConfigurationTarget.Global);
  update();

  vscode.window.showInformationMessage(`xlink:label pattern set to: ${pick.value.type}${pattern ? ` "${pattern}"` : ""}`);
}

async function clearParentTag() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await cfg.update("parentTag", null, vscode.ConfigurationTarget.Global);
  update();
  vscode.window.showInformationMessage("Parent tag cleared.");
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

  let placeholderValue = "";
  if (currentValue !== null && currentValue !== undefined) {
    if (Array.isArray(currentValue)) {
      placeholderValue = currentValue.join(", ");
    } else {
      placeholderValue = String(currentValue);
    }
  }

  const value = await vscode.window.showInputBox({
    prompt,
    value: placeholderValue,
    placeHolder: placeholderValue || "No value set",
  });

  if (value !== undefined) {
    const finalValue = transformer ? transformer(value) : value || null;
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
  const pick = await vscode.window.showQuickPick(options, {
    placeHolder: "Select XPath generation mode",
  });
  if (pick) {
    await vscode.workspace.getConfiguration(CONFIG_SECTION).update("mode", pick.value, vscode.ConfigurationTarget.Global);
    update();
  }
}

// 3. Update the copyXPath function to ensure config is loaded properly
async function copyXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) return;

  try {
    const config = xpathBuilder.loadConfiguration();

    if (config.useAttributeBasedIndexing) {
      console.log(
        `Attribute-based indexing enabled with attribute: ${config.attributeBasedIndexingAttribute}`
      );
    }

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

// update() with enhanced debug logging
function update() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) {
    return statusBarItem.hide();
  }

  try {
    const config = xpathBuilder.loadConfiguration();

    if (config.useAttributeBasedIndexing) {
      console.log(
        `Attribute-based indexing is ENABLED with attribute: ${config.attributeBasedIndexingAttribute}`
      );
    } else {
      console.log("Attribute-based indexing is DISABLED");
    }

    if (config.useXlinkLabelIndex) {
      console.log("xlink:label indexing is ENABLED");
    }

    // Log smart-relative landmark mode
    if (config.useSmartRelativePath) {
      console.log(`Smart relative enabled. Landmark mode: ${config.smartRelativeLandmarkMode ? "ON" : "OFF"}`);
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
