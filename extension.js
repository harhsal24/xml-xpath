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
    exceptionsToIndexOneForcing: new Set(cfg.get("exceptionsToIndexOneForcing", []))
  };
};

function activate(context) {
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
  };

  for (const [name, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
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

  // Tokenize the XML
  const events = xpathBuilder.tokenizeXML(xml, config);
  if (!events) {
    throw new Error("Failed to parse XML");
  }

  // Search for matching element
  return searchForElement(events, segments, xml);
}



// This version uses backticks (template literals) to store the regex patterns.
function parseXPath(xpath) {
    // Remove leading slash and split by /
    const parts = xpath.substring(1).split("/");
    const segments = [];

    // --- Step 1: Store all regular expression patterns in string variables using backticks. ---
    // The escaping rule is the same as for single quotes: double backslashes `\\`.
    const predicatePattern = `\
$$
([^\\[\
$$]+)\\]`;
    const positionOnlyPattern = `^\\d+$`;
    const attributePattern = `^@?([^=\\s]+)\\s*=\\s*['"]([^'"]*)['"]`;

    // Here's an example of how backticks can improve readability for complex patterns:
    const containsPattern = `
        contains\\(       # Match the literal text "contains("
        @([^,)]+),       # Match and capture the attribute name (anything but a comma or parenthesis)
        \\s*['"]          # Match optional whitespace and a quote
        ([^'"]+)         # Match and capture the attribute value
        ['"]\\)           # Match the closing quote and parenthesis
    `.replace(/\s/g, ''); // Remove all whitespace to make the regex valid

    const textPattern = `text\$\$\\s*=\\s*['"]([^'"]+)['"]`;
    const positionFuncPattern = `position\$\$\\s*=\\s*(\\d+)`;


    for (const part of parts) {
        const tagMatch = part.match(/^([^[\]]+)/);
        if (!tagMatch) continue;

        const tagName = tagMatch[1];
        const segment = { tagName, predicates: [] };

        const predicateRegex = new RegExp(predicatePattern, 'g');
        let predMatch;

        while ((predMatch = predicateRegex.exec(part))) {
            const predContent = predMatch[1];

            if (new RegExp(positionOnlyPattern).test(predContent)) {
                segment.predicates.push({
                    type: "position",
                    value: parseInt(predContent, 10),
                });
            }
            else if (predContent.includes("=")) {
                const attrMatch = predContent.match(new RegExp(attributePattern));
                if (attrMatch) {
                    segment.predicates.push({
                        type: "attribute",
                        name: attrMatch[1],
                        value: attrMatch[2],
                    });
                }
            }
            else if (predContent.startsWith("contains")) {
                const containsMatch = predContent.match(new RegExp(containsPattern));
                if (containsMatch) {
                    segment.predicates.push({
                        type: "contains",
                        target: containsMatch[1],
                        value: containsMatch[2],
                    });
                }
            }
            else if (predContent.startsWith("text()")) {
                const textMatch = predContent.match(new RegExp(textPattern));
                if (textMatch) {
                    segment.predicates.push({
                        type: "text",
                        value: textMatch[1],
                    });
                }
            }
            else if (predContent.startsWith("position()")) {
                const posMatch = predContent.match(new RegExp(positionFuncPattern));
                if (posMatch) {
                    segment.predicates.push({
                        type: "position",
                        value: parseInt(posMatch[1], 10),
                    });
                }
            }
        }
        segments.push(segment);
    }
    return segments;
}

// Add a new command for copying "universal" XPath that works across files
async function copyUniversalXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) return;
  
  try {
    // Save current configuration loader function
    const originalLoader = xpathBuilder.loadConfiguration;
    
    // Override with universal settings
    xpathBuilder.loadConfiguration = function() {
      const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
      return {
        parentTag: null,
        mode: { includeIndices: true, includeAttributes: true },
        preferredAttributes: cfg.get("preferredAttributes", ['id', 'name']), // Use configured or common attributes
        ignoreTags: new Set(),
        disableLeafIndex: false,
        skipSingleIndex: false,
        useXlinkLabelIndex: false, // Don't use xlink:label
        useParentScopedIndices: false,
        ignoreParentSegment: false,
        predicateTemplate: "[@{attr1}='{attr1V}']", // Standard format
        xlinkLabelPattern: { type: "any", pattern: "" },
          forceIndexOneFor: new Set(cfg.get("forceIndexOneFor", [])),  
    exceptionsToIndexOneForcing: new Set(cfg.get("exceptionsToIndexOneForcing", []))  
      };
    };
    
    // Generate XPath with universal settings
    const xpath = xpathBuilder.buildXPathRegex(
      editor.document,
      editor.selection.active
    );
    
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

function searchForElement(events, xpathSegments, xml) {
  const stack = [];
  const counters = [];
  let bestMatch = null;
  let maxMatchedDepth = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.type === "open") {
      // Update counters
      const depth = stack.length;
      if (!counters[depth]) counters[depth] = {};
      counters[depth][event.tag] = (counters[depth][event.tag] || 0) + 1;

      const currentIndex = counters[depth][event.tag];

      // Add to stack
      stack.push({
        tag: event.tag,
        index: currentIndex,
        attrs: event.attrs,
        startOffset: event.pos,
        eventIndex: i,
      });

      // Check how far we match
      const matchDepth = getMatchDepth(stack, xpathSegments);

      // If this is a better partial match, save it
      if (matchDepth > maxMatchedDepth) {
        maxMatchedDepth = matchDepth;

        // Find the end offset for the partially matched element
        let endOffset = event.pos + event.tag.length + 2;
        let openCount = 1;

        // Only look for closing tag if we're at the matched depth
        if (matchDepth === stack.length) {
          for (let j = i + 1; j < events.length; j++) {
            if (events[j].tag === event.tag) {
              if (events[j].type === "open") {
                openCount++;
              } else if (events[j].type === "close") {
                openCount--;
                if (openCount === 0) {
                  endOffset = events[j].pos;
                  break;
                }
              }
            }
          }
        }

                bestMatch = {
          tagName: event.tag,
          startOffset: event.pos,
          endOffset: endOffset,
          attrs: event.attrs,
          matchedDepth: matchDepth,
          totalDepth: xpathSegments.length,
          isPartial: matchDepth < xpathSegments.length,
        };
      }

      // Check if current path fully matches the XPath
      if (matchesXPath(stack, xpathSegments)) {
        // Find the end offset
        let endOffset = event.pos + event.tag.length + 2;
        let openCount = 1;
        for (let j = i + 1; j < events.length; j++) {
          if (events[j].tag === event.tag) {
            if (events[j].type === "open") {
              openCount++;
            } else if (events[j].type === "close") {
              openCount--;
              if (openCount === 0) {
                endOffset = events[j].pos;
                break;
              }
            }
          }
        }

        return {
          tagName: event.tag,
          startOffset: event.pos,
          endOffset: endOffset,
          attrs: event.attrs,
          matchedDepth: xpathSegments.length,
          totalDepth: xpathSegments.length,
          isPartial: false,
        };
      }
    } else if (event.type === "close") {
      // Pop from stack
      if (stack.length > 0 && stack[stack.length - 1].tag === event.tag) {
        stack.pop();
      }
    }
  }

  // Return the best partial match if no full match was found
  return bestMatch;
}

// Helper function to determine how deep the match goes
function getMatchDepth(stack, xpathSegments) {
  let depth = 0;

  for (let i = 0; i < Math.min(stack.length, xpathSegments.length); i++) {
    const stackItem = stack[i];
    const xpathSegment = xpathSegments[i];

    // Check tag name
    if (stackItem.tag !== xpathSegment.tagName) {
      break;
    }

    // Check predicates
    let predicatesMatch = true;
    for (const predicate of xpathSegment.predicates) {
      if (predicate.type === "position") {
        if (stackItem.index !== predicate.value) {
          predicatesMatch = false;
          break;
        }
      } else if (predicate.type === "attribute") {
        if (
          !stackItem.attrs ||
          stackItem.attrs[predicate.name] !== predicate.value
        ) {
          predicatesMatch = false;
          break;
        }
      }
    }

    if (!predicatesMatch) {
      break;
    }

    depth++;
  }

  return depth;
}

// Search with XPath function
async function searchWithXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) {
    vscode.window.showWarningMessage("Please open an XML file to search.");
    return;
  }

  // Get XPath from clipboard or prompt
  let xpath = await vscode.env.clipboard.readText();

  // If clipboard doesn't contain a valid XPath, prompt user
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
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );

      // Highlight the element
      const endPosition = editor.document.positionAt(result.endOffset);
      editor.selection = new vscode.Selection(position, endPosition);

      // Show appropriate message based on whether it's a full or partial match
      if (result.isPartial) {
        // Create a partial XPath string showing what was matched
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

function matchesXPath(stack, xpathSegments) {
  if (stack.length !== xpathSegments.length) return false;

  for (let i = 0; i < stack.length; i++) {
    const stackItem = stack[i];
    const xpathSegment = xpathSegments[i];

    // Check tag name
    if (stackItem.tag !== xpathSegment.tagName) return false;

    // Check predicates
    for (const predicate of xpathSegment.predicates) {
      if (predicate.type === "position") {
        if (stackItem.index !== predicate.value) return false;
      } else if (predicate.type === "attribute") {
        // Add null check for attrs
        if (
          !stackItem.attrs ||
          stackItem.attrs[predicate.name] !== predicate.value
        ) {
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
        const stackResult = xpathBuilder.buildElementStack(
          events,
          offset,
          config
        );
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
    placeHolder: currentValue || tagUnderCursor || "e.g., section, div, body",
  });

  if (value !== undefined) {
    await cfg.update(
      "parentTag",
      value || null,
      vscode.ConfigurationTarget.Global
    );
    update();

    // Show confirmation with example
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
    {
      label: "Colon: [attr:value='value']",
      value: "[{attr1}:value='{attr1V}']",
    },
    {
      label: "Contains: [contains(@attr, 'value')]",
      value: "[contains({at}{attr1}, '{attr1V}')]",
    },
    {
      label: "Position: [@attr='value'][position()=n]",
      value: "[@{attr1}='{attr1V}'][position()={idx}]",
    },
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
      prompt:
        "Predicate template. Tokens: {at}=@, {attr1}, {attr1V}, {tag}, {idx}, {xllv}, {xllvI}",
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
    await cfg.update(
      "predicateTemplate",
      value,
      vscode.ConfigurationTarget.Global
    );
    update();

    // Show example of what it will generate
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
  const currentPattern = cfg.get("xlinkLabelPattern", {
    type: "any",
    pattern: "",
  });

  const patternTypes = [
    {
      label: "Any number (default)",
      description: "Extract any number found in xlink:label",
      value: { type: "any", pattern: "" },
    },
    {
      label: "Starts with pattern",
      description: "e.g., 'order_' to match order_123",
      value: { type: "startsWith", pattern: "__input__" },
    },
    {
      label: "Contains pattern",
      description: "e.g., 'item' to match item123 or myitem456",
      value: { type: "contains", pattern: "__input__" },
    },
    {
      label: "Ends with pattern",
      description: "e.g., '_id' to match user_id, order_id",
      value: { type: "endsWith", pattern: "__input__" },
    },
    {
      label: "Regex pattern",
      description: "Custom regex to extract number",
      value: { type: "regex", pattern: "__input__" },
    },
    {
      label: "Exact prefix",
      description: "e.g., 'ID:' to match ID:123 exactly",
      value: { type: "exactPrefix", pattern: "__input__" },
    },
  ];

  const pick = await vscode.window.showQuickPick(patternTypes, {
    placeHolder: "Select how to match xlink:label values",
  });

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
      value:
        currentPattern.type === pick.value.type ? currentPattern.pattern : "",
    });

    if (!pattern) return;
  }

  const newPattern = { type: pick.value.type, pattern };

  await cfg.update(
    "xlinkLabelPattern",
    newPattern,
    vscode.ConfigurationTarget.Global
  );
  update();

  vscode.window.showInformationMessage(
    `xlink:label pattern set to: ${pick.value.type}${
      pattern ? ` "${pattern}"` : ""
    }`
  );
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

  // Format current value for display
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
    value: placeholderValue, // Pre-fill with current value
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
  vscode.window.showInformationMessage(
    `${message}: ${!current ? "ON" : "OFF"}`
  );
  update();
}

async function setMode() {
  const options = [
    { label: "Both", value: { includeIndices: true, includeAttributes: true } },
    {
      label: "Attributes Only",
      value: { includeIndices: false, includeAttributes: true },
    },
    {
      label: "Indices Only",
      value: { includeIndices: true, includeAttributes: false },
    },
    {
      label: "Simple (Tag path only)",
      value: { includeIndices: false, includeAttributes: false },
    },
  ];
  const pick = await vscode.window.showQuickPick(options, {
    placeHolder: "Select XPath generation mode",
  });
  if (pick) {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update("mode", pick.value, vscode.ConfigurationTarget.Global);
    update();
  }
}

async function copyXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) return;
  try {
    const xpath = xpathBuilder.buildXPathRegex(
      editor.document,
      editor.selection.active
    );
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

    const xpath = xpathBuilder.buildXPathRegex(
      editor.document,
      editor.selection.active
    );
    if (xpath) {
      const displayXPath =
        xpath.length > 80 ? xpath.substring(0, 77) + "..." : xpath;
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