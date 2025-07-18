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
    useAttributeBasedIndexing: cfg.get("useAttributeBasedIndexing", false), // ADD THIS
    attributeBasedIndexingAttribute: cfg.get(
      "attributeBasedIndexingAttribute",
      ""
    ), // ADD THIS
  };
};

function activate(context) {
  try {
    console.log('XML XPath extension is activating...');
    
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
    
    console.log('XML XPath extension activated successfully');
  } catch (error) {
    console.error('Error activating XML XPath extension:', error);
    vscode.window.showErrorMessage(`Failed to activate XML XPath: ${error.message}`);
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
  };

  for (const [name, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
  }
}

// Add this new function:
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
    vscode.window.showInformationMessage(
      `Attribute-based indexing will use: ${value}`
    );
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
  // Matches anything inside square brackets: “[ ... ]”
  predicate: /\[([^\]]+)\]/g,

  // Matches a pure number (position)
  position: /^\d+$/,

  // Matches @attr="value" or attr='value'
  attribute: /^@?([^=\s]+)\s*=\s*['"]([^'"]*)['"]/,

  // contains(@attr, 'value') — built from a string so we can strip whitespace/comments
  contains: new RegExp(
    `
      contains            # contains function
      \\s*\\(\\s*         # opening parenthesis
      @([^,)]+)           # attribute name
      ,\\s*               # comma
      ['"]([^'"]+)['"]    # quoted value
      \\s*\\)             # closing parenthesis
    `.replace(/\s+|#.*/g, ""), // remove whitespace/comments
    ""
  ),

  // “test” at end of line
  endOfLine: new RegExp(
    `
      test                # the word “test”
      $                   # end of line
    `.replace(/\s+|#.*/g, ""),
    ""
  ),

  // literal dollar sign then digits
  dollarAmount: new RegExp(
    `
      \\$                 # literal $
      (\\d+)              # one or more digits
    `.replace(/\s+|#.*/g, ""),
    ""
  ),

  // text()="..."
  text: /text\(\)\s*=\s*['"]([^'"]+)['"]/,

  // position()=n
  positionFunc: /position\(\)\s*=\s*(\d+)/,
};

function parseXPath(xpath) {
  console.log(`Parsing XPath: ${xpath}`);

  // Remove leading slash and split by /
  const parts = xpath.substring(1).split("/");
  const segments = [];

  for (const part of parts) {
    console.log(`\nProcessing part: "${part}"`);

    // Find the first [ to separate tag name from predicates
    const bracketIndex = part.indexOf("[");

    let tagName, predicatesPart;
    if (bracketIndex === -1) {
      // No predicates
      tagName = part;
      predicatesPart = "";
    } else {
      // Has predicates
      tagName = part.substring(0, bracketIndex);
      predicatesPart = part.substring(bracketIndex);
    }

    console.log(`Tag name: "${tagName}"`);
    console.log(`Predicates part: "${predicatesPart}"`);

    const segment = { tagName, predicates: [] };

    if (predicatesPart) {
      // Extract all [...] using regex - FIXED: Use \[ instead of $$
      const predicateRegex = /\[([^\]]+)\]/g;
      let predicateMatch;

      while ((predicateMatch = predicateRegex.exec(predicatesPart)) !== null) {
        const predContent = predicateMatch[1].trim();
        console.log(`Found predicate: "${predContent}"`);

        // Check if it's just a number (position)
        if (/^\d+$/.test(predContent)) {
          segment.predicates.push({
            type: "position",
            value: parseInt(predContent, 10),
          });
          console.log(`  -> Parsed as position: ${predContent}`);
        }
        // Check for attribute predicates
        else if (predContent.includes("=")) {
          // Match @attribute='value' or attribute='value'
          const attrMatch = predContent.match(
            /^@?([^=\s]+)\s*=\s*['"]([^'"]*)['"]/
          );
          if (attrMatch) {
            segment.predicates.push({
              type: "attribute",
              name: attrMatch[1],
              value: attrMatch[2],
            });
            console.log(
              `  -> Parsed as attribute: ${attrMatch[1]}='${attrMatch[2]}'`
            );
          }
        }
        // Handle contains()
        else if (predContent.startsWith("contains")) {
          // FIXED: Removed $ from the regex pattern
          const containsMatch = predContent.match(
            /contains\s*\(\s*@([^,)]+),\s*['"]([^'"]+)['"]\s*\)/
          );
          if (containsMatch) {
            segment.predicates.push({
              type: "contains",
              target: containsMatch[1],
              value: containsMatch[2],
            });
            console.log(
              `  -> Parsed as contains: ${containsMatch[1]} contains '${containsMatch[2]}'`
            );
          }
        }
        // Handle text()
        else if (predContent.startsWith("text()")) {
          const textMatch = predContent.match(
            /text\(\)\s*=\s*['"]([^'"]+)['"]/
          );
          if (textMatch) {
            segment.predicates.push({
              type: "text",
              value: textMatch[1],
            });
            console.log(`  -> Parsed as text: '${textMatch[1]}'`);
          }
        }
        // Handle position()
        else if (predContent.startsWith("position()")) {
          const posMatch = predContent.match(/position\(\)\s*=\s*(\d+)/);
          if (posMatch) {
            segment.predicates.push({
              type: "position",
              value: parseInt(posMatch[1], 10),
            });
            console.log(`  -> Parsed as position function: ${posMatch[1]}`);
          }
        }
        // Handle last()
        else if (predContent === "last()") {
          segment.predicates.push({
            type: "last",
          });
          console.log(`  -> Parsed as last()`);
        }
        // Handle other predicates
        else {
          segment.predicates.push({
            type: "other",
            value: predContent,
          });
          console.log(`  -> Parsed as other: ${predContent}`);
        }
      }
    }

    segments.push(segment);
  }

  console.log("\nFinal parsed segments:", JSON.stringify(segments, null, 2));
  return segments;
}

async function copyUniversalXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) return;

  try {
    // Save current configuration loader function
    const originalLoader = xpathBuilder.loadConfiguration;

    // Override with universal settings - FIXED: Keep attribute-based indexing if enabled
    const currentConfig = originalLoader();
    xpathBuilder.loadConfiguration = function () {
      return {
        parentTag: null,
        mode: { includeIndices: true, includeAttributes: true },
        preferredAttributes: currentConfig.preferredAttributes || [
          "id",
          "name",
        ],
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
        // FIXED: Preserve attribute-based indexing settings
        useAttributeBasedIndexing: currentConfig.useAttributeBasedIndexing,
        attributeBasedIndexingAttribute:
          currentConfig.attributeBasedIndexingAttribute,
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
        if (
          config.preferredAttributes &&
          config.preferredAttributes.length > 0
        ) {
          for (const attr of config.preferredAttributes) {
            if (event.attrs && event.attrs[attr]) {
              indexingAttribute = attr;
              indexingValue = event.attrs[attr];
              break;
            }
          }
        }
      }

      // Calculate index based on mode (matching buildElementStack exactly)
      if (
        config.useAttributeBasedIndexing &&
        indexingAttribute &&
        indexingValue
      ) {
        // Attribute-based indexing
        const key = `${depth}-${event.tag}-${indexingAttribute}-${indexingValue}`;

        if (!attributeCounters[key]) {
          attributeCounters[key] = 0;
        }
        attributeCounters[key]++;
        idx = attributeCounters[key];
      } else if (config.useParentScopedIndices) {
        // Parent-scoped indexing
        const parentPath = stack.map((e) => `${e.tag}[${e.index}]`).join("/");
        if (!counters[parentPath]) counters[parentPath] = {};
        counters[parentPath][event.tag] =
          (counters[parentPath][event.tag] || 0) + 1;
        idx = counters[parentPath][event.tag];
      } else {
        // Depth-based indexing
        const depth = stack.length;
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
        index: idx, // Add both for compatibility
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
      const matchResult = checkFullMatchWithConfig(
        stack,
        xpathSegments,
        config
      );

      if (matchResult.depth > 0) {
        console.log(
          `Match depth: ${matchResult.depth}/${xpathSegments.length}, ` +
            `isFullMatch: ${matchResult.isFullMatch}, ` +
            `path: ${matchResult.matchedPath}`
        );
      }

      // Update best match
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
        console.log("Full match found!");

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

  console.log(
    `No full match found. Best match depth: ${maxMatchedDepth}/${xpathSegments.length}`
  );
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
      console.log(
        `Tag mismatch at depth ${i}: ${stackItem.tag} !== ${xpathSegment.tagName}`
      );
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

        // If using xlink:label indexing, check customIndex
        if (config.useXlinkLabelIndex && stackItem.customIndex !== undefined) {
          actualIndex = stackItem.customIndex;
        }

        if (actualIndex !== expectedIndex) {
          console.log(
            `Position mismatch at depth ${i}: element at index ${actualIndex} !== expected ${expectedIndex}`
          );
          allPredicatesMatch = false;
          break;
        }
        pathPart += `[${predicate.value}]`;
      } else if (predicate.type === "attribute") {
        if (
          !stackItem.attrs ||
          stackItem.attrs[predicate.name] !== predicate.value
        ) {
          console.log(
            `Attribute mismatch at depth ${i}: ${predicate.name}='${
              stackItem.attrs?.[predicate.name] || "undefined"
            }' !== '${predicate.value}'`
          );
          allPredicatesMatch = false;
          break;
        }
        pathPart += `[@${predicate.name}='${predicate.value}']`;
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

// 2. FIXED: Update checkFullMatch to consider attribute-based indexing
function checkFullMatch(stack, xpathSegments, config) {
  let depth = 0;
  const matchedPath = [];

  for (let i = 0; i < Math.min(stack.length, xpathSegments.length); i++) {
    const stackItem = stack[i];
    const xpathSegment = xpathSegments[i];

    // Check tag name
    if (stackItem.tag !== xpathSegment.tagName) {
      console.log(
        `Tag mismatch at depth ${i}: ${stackItem.tag} !== ${xpathSegment.tagName}`
      );
      break;
    }

    // Check all predicates
    let allPredicatesMatch = true;
    let pathPart = stackItem.tag;

    for (const predicate of xpathSegment.predicates) {
      if (predicate.type === "position") {
        // FIXED: For attribute-based indexing, we need to check if the position
        // matches the element's index in the attribute-based context
        const expectedIndex = predicate.value;

        // Check if this matches how we counted during building
        if (
          config.useAttributeBasedIndexing &&
          config.attributeBasedIndexingAttribute &&
          stackItem.attrs &&
          stackItem.attrs[config.attributeBasedIndexingAttribute]
        ) {
          // For attribute-based indexing, the index should match elements
          // with the same attribute value
          if (stackItem.index !== expectedIndex) {
            console.log(
              `Attribute-based position mismatch at depth ${i}: element at index ${stackItem.index} !== expected ${expectedIndex}`
            );
            allPredicatesMatch = false;
            break;
          }
        } else if (stackItem.index !== expectedIndex) {
          console.log(
            `Position mismatch at depth ${i}: element at index ${stackItem.index} !== expected ${expectedIndex}`
          );
          allPredicatesMatch = false;
          break;
        }
        pathPart += `[${predicate.value}]`;
      } else if (predicate.type === "attribute") {
        if (
          !stackItem.attrs ||
          stackItem.attrs[predicate.name] !== predicate.value
        ) {
          console.log(
            `Attribute mismatch at depth ${i}: ${predicate.name}='${
              stackItem.attrs?.[predicate.name] || "undefined"
            }' !== '${predicate.value}'`
          );
          allPredicatesMatch = false;
          break;
        }
        pathPart += `[@${predicate.name}='${predicate.value}']`;
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

// Helper function to check how deep the current stack matches the XPath
function checkMatchDepth(stack, xpathSegments) {
  let depth = 0;

  for (let i = 0; i < Math.min(stack.length, xpathSegments.length); i++) {
    const stackItem = stack[i];
    const xpathSegment = xpathSegments[i];

    // Check tag name
    if (stackItem.tag !== xpathSegment.tagName) {
      return depth;
    }

    // Check all predicates
    let allPredicatesMatch = true;

    for (const predicate of xpathSegment.predicates) {
      if (predicate.type === "position") {
        // For position predicates, check if we have the right index
        // But we need to check this in context of any attribute predicates
        const hasAttrPredicates = xpathSegment.predicates.some(
          (p) => p.type === "attribute"
        );

        if (hasAttrPredicates) {
          // First verify all attribute predicates match
          const attrMatch = xpathSegment.predicates
            .filter((p) => p.type === "attribute")
            .every(
              (p) => stackItem.attrs && stackItem.attrs[p.name] === p.value
            );

          if (!attrMatch) {
            allPredicatesMatch = false;
            break;
          }
        }

        // Now check the position
        if (stackItem.index !== predicate.value) {
          allPredicatesMatch = false;
          break;
        }
      } else if (predicate.type === "attribute") {
        if (
          !stackItem.attrs ||
          stackItem.attrs[predicate.name] !== predicate.value
        ) {
          allPredicatesMatch = false;
          break;
        }
      }
    }

    if (!allPredicatesMatch) {
      return depth;
    }

    depth++;
  }

  return depth;
}

// Helper function to determine how deep the match goes
function getMatchDepth(stack, xpathSegments) {
  let depth = 0;

  for (let i = 0; i < Math.min(stack.length, xpathSegments.length); i++) {
    const stackItem = stack[i];
    const xpathSegment = xpathSegments[i];

    // Check tag name
    if (stackItem.tag !== xpathSegment.tagName) {
      console.log(
        `Tag mismatch at depth ${i}: ${stackItem.tag} !== ${xpathSegment.tagName}`
      );
      break;
    }

    // Check ALL predicates
    let allPredicatesMatch = true;

    for (const predicate of xpathSegment.predicates) {
      if (predicate.type === "position") {
        // For elements with attribute predicates, we need to check the actual counted index
        const hasAttrPredicates = xpathSegment.predicates.some(
          (p) => p.type === "attribute"
        );

        if (hasAttrPredicates) {
          // Check if all attribute predicates match first
          const attrPredicatesMatch = xpathSegment.predicates
            .filter((p) => p.type === "attribute")
            .every(
              (p) => stackItem.attrs && stackItem.attrs[p.name] === p.value
            );

          if (!attrPredicatesMatch || stackItem.index !== predicate.value) {
            console.log(
              `Position mismatch at depth ${i}: ${stackItem.index} !== ${predicate.value} (with attributes)`
            );
            allPredicatesMatch = false;
            break;
          }
        } else if (stackItem.index !== predicate.value) {
          console.log(
            `Position mismatch at depth ${i}: ${stackItem.index} !== ${predicate.value}`
          );
          allPredicatesMatch = false;
          break;
        }
      } else if (predicate.type === "attribute") {
        if (
          !stackItem.attrs ||
          stackItem.attrs[predicate.name] !== predicate.value
        ) {
          console.log(
            `Attribute mismatch at depth ${i}: ${predicate.name}='${
              stackItem.attrs?.[predicate.name] || "undefined"
            }' !== '${predicate.value}'`
          );
          allPredicatesMatch = false;
          break;
        }
      }
    }

    if (!allPredicatesMatch) {
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

    // Check ALL predicates must match
    for (const predicate of xpathSegment.predicates) {
      if (predicate.type === "position") {
        // THIS IS THE KEY FIX - check the actual index
        if (stackItem.index !== predicate.value) {
          console.log(
            `Position mismatch: element index ${stackItem.index} !== expected ${predicate.value}`
          );
          return false;
        }
      } else if (predicate.type === "attribute") {
        // Check attribute exists and matches exactly
        if (
          !stackItem.attrs ||
          !stackItem.attrs.hasOwnProperty(predicate.name) ||
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

// 3. FIXED: Update the copyXPath function to ensure config is loaded properly
async function copyXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) return;

  try {
    // Ensure configuration is loaded fresh
    const config = xpathBuilder.loadConfiguration();

    // Debug logging
    if (config.useAttributeBasedIndexing) {
      console.log(
        `Attribute-based indexing enabled with attribute: ${config.attributeBasedIndexingAttribute}`
      );
    }

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

// 6. ADDITIONAL: Enhanced debug logging for the update function
function update() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) {
    return statusBarItem.hide();
  }

  try {
    const config = xpathBuilder.loadConfiguration();

    // Enhanced debug logging
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
