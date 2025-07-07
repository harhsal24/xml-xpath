const vscode = require("vscode");
const { XMLParser } = require("fast-xml-parser");

const CONFIG_SECTION = "xmlXpath";
let statusBarItem;

// Optimized parser configuration
const parserOptions = {
  ignoreAttributes: false,
  preserveOrder: true,
  trimValues: false,
  parseAttributeValue: false,
  ignoreNameSpace: false,
  allowBooleanAttributes: true,
  parseNodeValue: false,
  parseTagValue: false,
  parseTrueNumberOnly: false,
};

class XPathBuilder {
  constructor() {
    this.parser = new XMLParser(parserOptions);
    this.cache = new Map();
  }

  // Get or create cached document structure
  getDocumentStructure(document) {
    const uri = document.uri.toString();
    const version = document.version;

    if (this.cache.has(uri)) {
      const cached = this.cache.get(uri);
      if (cached.version === version) {
        return cached.structure;
      }
    }

    try {
      const text = document.getText();

      // For very large documents, use regex fallback
      if (text.length > 500000) {
        // 500KB threshold
        console.log("Document too large, using regex fallback");
        return null; // Will trigger regex fallback
      }

      // For moderately large documents, try partial parsing
      if (text.length > 100000) {
        // 100KB threshold
        return this.parsePartialDocument(document, text);
      }

      // For smaller documents, parse fully
      const structure = this.parseFullDocument(text);
      this.cache.set(uri, { version, structure });
      return structure;
    } catch (error) {
      console.error("XML parsing error:", error);
      return null; // Will trigger regex fallback
    }
  }

  parseFullDocument(xmlText) {
    try {
      // Clean XML before parsing
      const cleanXml = this.preprocessXml(xmlText);
      const parsed = this.parser.parse(cleanXml);

      return {
        type: "full",
        structure: parsed,
        originalText: xmlText,
      };
    } catch (error) {
      console.error("Full document parsing failed:", error);
      throw error;
    }
  }

  parsePartialDocument(document, xmlText) {
    const position = vscode.window.activeTextEditor?.selection.active;
    if (!position) return null;

    const offset = document.offsetAt(position);

    try {
      // Extract a reasonable window around the cursor
      const windowSize = 50000; // 50KB window
      const start = Math.max(0, offset - windowSize / 2);
      const end = Math.min(xmlText.length, offset + windowSize / 2);

      // Find complete XML section
      const partialXml = this.extractCompleteXmlSection(xmlText, start, end);

      if (!partialXml) {
        throw new Error("Could not extract valid XML section");
      }

      const cleanXml = this.preprocessXml(partialXml.xml);
      const parsed = this.parser.parse(cleanXml);

      return {
        type: "partial",
        startOffset: partialXml.startOffset,
        structure: parsed,
        cursorOffset: offset - partialXml.startOffset,
        originalText: xmlText,
      };
    } catch (error) {
      console.error("Partial parsing failed:", error);
      throw error;
    }
  }

  extractCompleteXmlSection(xmlText, start, end) {
    // Find the nearest complete XML elements around the cursor
    let tagStart = start;
    let tagEnd = end;
    let openTags = [];

    // Move backwards to find a reasonable starting point
    while (tagStart > 0) {
      if (xmlText[tagStart] === "<" && xmlText[tagStart + 1] !== "/") {
        // Found opening tag, let's use this as start
        break;
      }
      tagStart--;
    }

    // Move forward to find matching closing tags
    let pos = tagStart;
    while (pos < xmlText.length && pos < end + 10000) {
      // Safety limit
      const match = xmlText.substring(pos).match(/<(\/?)([\w:\-\.]+)[^>]*>/);
      if (!match) break;

      const isClosing = match[1] === "/";
      const tagName = match[2];
      const fullMatch = match[0];

      if (!isClosing && !fullMatch.endsWith("/>")) {
        openTags.push(tagName);
      } else if (isClosing && openTags.length > 0) {
        const lastTag = openTags[openTags.length - 1];
        if (lastTag === tagName) {
          openTags.pop();
          if (openTags.length === 0 && pos > end) {
            // Found balanced XML section
            tagEnd = pos + fullMatch.length;
            break;
          }
        }
      }

      pos += match.index + fullMatch.length;
    }

    if (tagStart >= tagEnd) {
      return null;
    }

    const fragment = xmlText.substring(tagStart, tagEnd);
    return {
      xml: fragment,
      startOffset: tagStart,
    };
  }

  preprocessXml(xmlText) {
    // Remove XML declaration if present
    let cleaned = xmlText.replace(/<\?xml[^>]*\?>/i, "");

    // Remove comments
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");

    // Handle CDATA sections (preserve content but escape it)
    cleaned = cleaned.replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/g,
      (match, content) => {
        return this.escapeXml(content);
      }
    );

    // Remove DOCTYPE declarations
    cleaned = cleaned.replace(/<!DOCTYPE[^>]*>/i, "");

    return cleaned.trim();
  }

  escapeXml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

buildXPath(document, position) {
    const structure = this.getDocumentStructure(document);

    // If parsing failed or document is too large, fall back to regex
    if (!structure) {
      return this.buildXPathRegex(document, position); // Make sure both parameters are passed
    }

    const offset = document.offsetAt(position);

    // For now, we'll still use the regex approach as the main XPath builder
    return this.buildXPathRegex(document, position); // Make sure both parameters are passed
}

// To make sure it has both parameters:
buildXPathRegex(document, position) {
    const xml = document.getText();
    const offset = document.offsetAt(position);
    const config = this.loadConfiguration();
    
    // Tokenize XML
    const events = this.tokenizeXML(xml, offset,config);
    if (!events) return null;
    
    // Build element stack with indices
    const stackResult = this.buildElementStack(events, offset, config);
    if (!stackResult || !stackResult.stack.length) return null;
    
    // Process path based on configuration
    const path = this.processPath(stackResult.stack, config);
    if (!path.length) return null;
    
    // Generate XPath string
    return this.generateXPath(path, config);
}

  /**
   * Load configuration settings
   */
  loadConfiguration() {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return {
      parentTag: cfg.get("parentTag", null),
      mode: cfg.get("mode", { includeIndices: true, includeAttributes: true }),
      preferredAttributes: cfg.get("preferredAttributes", []),
      ignoreTags: new Set(cfg.get("ignoreIndexTags", [])),
      predicateTemplate: cfg.get("mode", {}).includeAttributes
        ? cfg.get("predicateTemplate", "[@{attr1}='{attr1V}']")
        : null,
      disableLeafIndex: cfg.get("disableLeafIndex", false),
      skipSingleIndex: cfg.get("skipSingleIndex", false),
      useXlinkLabelIndex: cfg.get("useXlinkLabelIndex", false),
      useParentScopedIndices: cfg.get("useParentScopedIndices", false),
      ignoreParentSegment: cfg.get("ignoreParentSegment", false),
       maxParseSize: cfg.get("maxParseSize", 1000000), // 1MB default
    };
  }

/**
 * Tokenize XML into events
 */
tokenizeXML(xml, offset, config) {
  // Use the preprocessing method
  const cleanedXml = this.preprocessForTokenization(xml);
  
  const tokenRegex = /<(\/)?([\w:\-\.]+)([^>]*?)(\/?)>/g;
  const events = [];
  let match;
  
  // For very large documents, use a different strategy
  const useFullParse = !config || xml.length <= (config.maxParseSize || 1000000);

  try {
    while ((match = tokenRegex.exec(cleanedXml))) {
      const event = this.parseXMLToken(match);
      if (event) {
        events.push(event);

        // Add close event for self-closing tags
        if (event.type === "open" && event.selfClose) {
          events.push({ type: "close", tag: event.tag, pos: event.pos });
        }
      }
      
      // For large documents, stop after parsing enough context
      if (!useFullParse && match.index > offset + 50000) {
        break;
      }
    }
    return events;
  } catch (error) {
    console.error("XML tokenization error:", error);
    return null;
  }
}

/**
 * Preprocess XML for tokenization (remove CDATA, comments, and other non-element content)
 */
preprocessForTokenization(xml) {
  let processed = xml;
  
  // Handle CDATA sections using string operations
  let cdataStart = processed.indexOf('<![CDATA[');
  while (cdataStart !== -1) {
    const cdataEnd = processed.indexOf(']]>', cdataStart);
    if (cdataEnd !== -1) {
      const cdataLength = cdataEnd + 3 - cdataStart;
      processed = processed.substring(0, cdataStart) + 
                  ' '.repeat(cdataLength) + 
                  processed.substring(cdataEnd + 3);
    }
    cdataStart = processed.indexOf('<![CDATA[', cdataStart + 1);
  }
  
  // Handle comments using string operations
  let commentStart = processed.indexOf('<!--');
  while (commentStart !== -1) {
    const commentEnd = processed.indexOf('-->', commentStart);
    if (commentEnd !== -1) {
      const commentLength = commentEnd + 3 - commentStart;
      processed = processed.substring(0, commentStart) + 
                  ' '.repeat(commentLength) + 
                  processed.substring(commentEnd + 3);
    }
    commentStart = processed.indexOf('<!--', commentStart + 1);
  }
  
  // Remove XML declarations
  processed = processed.replace(/<\?xml[^>]*\?>/gi, (match) => {
    return ' '.repeat(match.length);
  });
  
  // Remove DOCTYPE declarations
  processed = processed.replace(/<!DOCTYPE[^>]*>/gi, (match) => {
    return ' '.repeat(match.length);
  });
  
  // Remove processing instructions
  processed = processed.replace(/<\?[^>]*\?>/g, (match) => {
    return ' '.repeat(match.length);
  });
  
  return processed;
}

/**
 * Create offset mapping for preprocessed XML
 */
createOffsetMap(original, processed) {
  const map = new Map();
  let offset = 0;
  
  for (let i = 0; i < processed.length; i++) {
    if (processed[i] !== ' ' || original[i] !== ' ') {
      map.set(i, i + offset);
    }
  }
  
  return map;
}
/**
 * Build element stack with proper indexing
 */
buildElementStack(events, offset, config) {
  const stack = [];
  const counters = config.useParentScopedIndices ? {} : [];
  const currentStack = [];
  let targetStack = null;
  let lastPos = 0;

  for (const event of events) {
    if (event.type === "open") {
      const depth = currentStack.length;
      let idx;
      
      if (config.useParentScopedIndices) {
        // Parent-scoped counting
        const parentPath = currentStack.map(e => e.tag).join('/');
        if (!counters[parentPath]) counters[parentPath] = {};
        counters[parentPath][event.tag] = (counters[parentPath][event.tag] || 0) + 1;
        idx = counters[parentPath][event.tag];
      } else {
        // Depth-based counting
        if (!counters[depth]) counters[depth] = {};
        counters[depth][event.tag] = (counters[depth][event.tag] || 0) + 1;
        idx = counters[depth][event.tag];
      }

      const { attrName, attrValue } = this.selectPreferredAttribute(
        event.attrs,
        config.preferredAttributes
      );

      const element = {
        tag: event.tag,
        idx,
        customIndex: event.customIndex,
        customIndexRaw: event.customIndexRaw,
        attrName,
        attrValue,
        startPos: event.pos
      };
      
      currentStack.push(element);
      lastPos = event.pos;
      
    } else if (event.type === "close") {
      if (currentStack.length && currentStack[currentStack.length - 1].tag === event.tag) {
        const opening = currentStack[currentStack.length - 1];
        
        // Check if cursor is inside this element
        if (!targetStack && opening.startPos <= offset && event.pos >= offset) {
          // Found the element containing the cursor
          targetStack = currentStack.map(e => ({...e}));
        }
        
        currentStack.pop();
      }
      lastPos = event.pos;
    }
    
    // Also check if cursor is right after an opening tag
    if (!targetStack && lastPos <= offset && event.pos > offset) {
      targetStack = currentStack.map(e => ({...e}));
    }
  }

  // If we didn't find the cursor position, use the last valid stack
  return { stack: targetStack || currentStack, counters };
}

  /**
   * Parse a single XML token match
   */
  parseXMLToken(match) {
    const [fullMatch, closeSlash, tag, attrsText, selfCloseSlash] = match;
    const isClose = !!closeSlash;
    const selfClose = !!selfCloseSlash;
    const pos = match.index;

    if (isClose) {
      return { type: "close", tag, pos };
    }

    const attrs = this.parseAttributes(attrsText || "");
    const xlinkData = this.parseXlinkLabel(attrs);

    return {
      type: "open",
      tag,
      attrs: attrs.regular,
      pos,
      selfClose,
      ...xlinkData,
    };
  }

  /**
   * Parse attributes from attribute text
   */
  parseAttributes(attrsText) {
    const regular = {};
    let xlinkLabel = null;

    attrsText.replace(
      /([\w:\-\.]+)\s*=\s*(['"])((?:(?!\2)[^\\]|\\.)*)(?:\2)/g,
      (_, key, _quote, value) => {
        if (key === "xlink:label") {
          xlinkLabel = value;
        } else if (!key.startsWith("xmlns")) {
          regular[key] = value;
        }
      }
    );

    return { regular, xlinkLabel };
  }

  /**
   * Parse xlink:label for custom indexing
   */
  parseXlinkLabel(attrs) {
    if (!attrs.xlinkLabel) {
      return { customIndex: undefined, customIndexRaw: undefined };
    }

    const customIndexRaw = attrs.xlinkLabel;
    const numMatch = customIndexRaw.match(/(\d+)$/);
    const customIndex = numMatch ? parseInt(numMatch[1], 10) : undefined;

    return { customIndex, customIndexRaw };
  }

/**
 * Build element stack with proper indexing
 */
buildElementStack(events, offset, config) {
  const stack = [];
  const allElements = [];
  let currentPath = [];
  
  // First pass: build complete element tree structure
  for (const event of events) {
    if (event.type === "open") {
      const element = {
        tag: event.tag,
        pos: event.pos,
        depth: currentPath.length,
        attrs: event.attrs,
        customIndex: event.customIndex,
        customIndexRaw: event.customIndexRaw,
        path: [...currentPath]
      };
      allElements.push(element);
      currentPath.push(event.tag);
    } else if (event.type === "close") {
      currentPath.pop();
    }
  }
  
  // Second pass: calculate indices for each element
  const indexMap = new Map();
  for (const element of allElements) {
    const pathKey = element.path.join('/');
    const siblingKey = `${pathKey}/${element.tag}`;
    
    if (!indexMap.has(siblingKey)) {
      indexMap.set(siblingKey, 0);
    }
    indexMap.set(siblingKey, indexMap.get(siblingKey) + 1);
    element.idx = indexMap.get(siblingKey);
  }
  
  // Third pass: build stack for cursor position
  currentPath = [];
  for (const event of events) {
    if (event.pos > offset) break;
    
    if (event.type === "open") {
      // Find the matching element from our pre-calculated elements
      const element = allElements.find(el => el.pos === event.pos);
      if (element) {
        const { attrName, attrValue } = this.selectPreferredAttribute(
          element.attrs,
          config.preferredAttributes
        );
        
        stack.push({
          tag: element.tag,
          idx: element.idx,
          customIndex: element.customIndex,
          customIndexRaw: element.customIndexRaw,
          attrName,
          attrValue,
        });
      }
    } else if (event.type === "close") {
      if (stack.length && stack[stack.length - 1].tag === event.tag) {
        stack.pop();
      }
    }
  }
  
  return { stack };
}

  /**
   * Create counters based on indexing mode
   */
  createCounters(useParentScoped) {
    return useParentScoped ? {} : [];
  }

  /**
   * Process an opening tag
   */
  processOpenTag(event, stack, counters, config) {
    const depth = stack.length;
    const idx = this.calculateIndex(
      event.tag,
      depth,
      counters,
      config.useParentScopedIndices
    );

    const { attrName, attrValue } = this.selectPreferredAttribute(
      event.attrs,
      config.preferredAttributes
    );

    return {
      tag: event.tag,
      idx,
      customIndex: event.customIndex,
      customIndexRaw: event.customIndexRaw,
      attrName,
      attrValue,
    };
  }

  /**
   * Calculate element index
   */
  calculateIndex(tag, depth, counters, useParentScoped) {
    if (useParentScoped) {
      counters[depth] = counters[depth] || {};
      counters[depth][tag] = (counters[depth][tag] || 0) + 1;
      return counters[depth][tag];
    } else {
      counters[depth] = counters[depth] || {};
      counters[depth][tag] = (counters[depth][tag] || 0) + 1;
      return counters[depth][tag];
    }
  }

  /**
   * Select preferred attribute for predicates
   */
  selectPreferredAttribute(attrs, preferredList) {
    for (const preferred of preferredList) {
      if (attrs[preferred]) {
        return { attrName: preferred, attrValue: attrs[preferred] };
      }
    }
    return { attrName: null, attrValue: null };
  }

  /**
   * Process a closing tag
   */
  processCloseTag(event, stack, counters, config) {
    if (stack.length && stack[stack.length - 1].tag === event.tag) {
      stack.pop();
      if (config.useParentScopedIndices) {
        delete counters[stack.length];
      }
    }
  }

  /**
   * Process path based on parent tag configuration
   */
  processPath(stack, config) {
    let path = stack;

    if (config.parentTag) {
      const parentIndex = stack.findIndex((n) => n.tag === config.parentTag);
      if (parentIndex >= 0) {
        path = stack.slice(parentIndex);
      }
    }

    if (config.parentTag && config.ignoreParentSegment && path.length) {
      path = path.slice(1);
    }

    return path;
  }

  /**
   * Generate XPath string from path
   */
  generateXPath(path, config) {
    try {
      const segments = path.map((node, index) =>
        this.generateXPathSegment(node, index, path.length, config)
      );

      return "/" + segments.join("/");
    } catch (error) {
      console.error("XPath generation error:", error);
      return null;
    }
  }

  /**
   * Generate a single XPath segment
   */
  generateXPathSegment(node, index, pathLength, config) {
    const isLeaf = index === pathLength - 1;
    let segment = node.tag;

    // Add attribute predicate
    segment += this.generateAttributePredicate(node, config);

    // Add index
    segment += this.generateIndex(node, isLeaf, config);

    return segment;
  }

  /**
   * Generate attribute predicate
   */
  generateAttributePredicate(node, config) {
    if (!node.attrName || !node.attrValue) return "";

    if (config.predicateTemplate) {
      const data = {
        tag: node.tag,
        attr1: node.attrName,
        attr1V: node.attrValue,
        xllv: node.customIndexRaw || "",
        xllvI: node.customIndex != null ? node.customIndex : "",
        idx: node.idx,
      };
      return config.predicateTemplate.replace(
        /\{(\w+)\}/g,
        (_, k) => data[k] || ""
      );
    } else if (config.mode.includeAttributes) {
      const escapedValue = this.escapeAttributeValue(node.attrValue);
      return `[@${node.attrName}='${escapedValue}']`;
    }

    return "";
  }

  /**
   * Generate index predicate
   */
  generateIndex(node, isLeaf, config) {
    // Skip index based on configuration
    if (isLeaf && config.disableLeafIndex) return "";
    if (!config.mode.includeIndices) return "";

    // Determine which index to use
    let index =
      config.useXlinkLabelIndex && node.customIndex != null
        ? node.customIndex
        : node.idx;

    // Skip based on rules
    if (config.skipSingleIndex && index === 1) return "";
    if (index === 1 && config.ignoreTags.has(node.tag)) return "";

    return `[${index}]`;
  }

  /**
   * Escape attribute value for XPath
   */
  escapeAttributeValue(value) {
    return value.replace(/'/g, "&apos;");
  }

  clearCache(uri) {
    if (uri) {
      this.cache.delete(uri.toString());
    } else {
      this.cache.clear();
    }
  }
}

// Global XPath builder instance
const xpathBuilder = new XPathBuilder();

function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "xmlXpath.copyXPath";
  context.subscriptions.push(statusBarItem);

  // Register all commands
  registerCommands(context);

  // Optimized update handlers with debouncing
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(debounce(update, 150))
  );

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(update));

  // Clear cache when documents change
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      // Debounce cache clearing to avoid excessive operations
      debounce(() => xpathBuilder.clearCache(event.document.uri), 300)();
    })
  );

  // Clear cache when documents are closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      xpathBuilder.clearCache(document.uri);
    })
  );

  update();
}

function registerCommands(context) {
  const commands = [
    ["xmlXpath.setParent", setParent],
    ["xmlXpath.clearParent", clearParent],
    ["xmlXpath.setMode", setMode],
    ["xmlXpath.setPreferredAttributes", setPreferredAttrs],
    ["xmlXpath.setIgnoreIndexTags", setIgnoreTags],
    ["xmlXpath.setTemplate", setTemplate],
    ["xmlXpath.copyXPath", copyXPath],
    ["xmlXpath.toggleDisableLeafIndex", toggleDisableLeafIndex],
    ["xmlXpath.toggleSkipSingleIndex", toggleSkipSingleIndex],
    ["xmlXpath.toggleUseXlinkLabelIndex", toggleUseXlinkLabelIndex],
    ["xmlXpath.toggleParentScopedIndexing", toggleParentScopedIndexing],
    ["xmlXpath.toggleIgnoreParentSegment", toggleIgnoreParentSegment],
  ];

  commands.forEach(([name, handler]) => {
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
  });
}

function deactivate() {
  if (statusBarItem) statusBarItem.dispose();
  xpathBuilder.clearCache();
}

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Command implementations

async function toggleIgnoreParentSegment() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("ignoreParentSegment", false);
  await cfg.update(
    "ignoreParentSegment",
    !current,
    vscode.ConfigurationTarget.Global
  );
  vscode.window.showInformationMessage(
    `Ignore Parent Segment: ${!current ? "ON" : "OFF"}`
  );
  update();
}

async function toggleDisableLeafIndex() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("disableLeafIndex", false);
  await cfg.update(
    "disableLeafIndex",
    !current,
    vscode.ConfigurationTarget.Global
  );
  vscode.window.showInformationMessage(`disableLeafIndex: ${!current}`);
  update();
}

async function toggleParentScopedIndexing() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("useParentScopedIndices", false);
  await cfg.update(
    "useParentScopedIndices",
    !current,
    vscode.ConfigurationTarget.Global
  );
  vscode.window.showInformationMessage(
    `Parent‑scoped indexing: ${!current ? "ON" : "OFF"}`
  );
  update();
}

async function toggleUseXlinkLabelIndex() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("useXlinkLabelIndex", false);
  await cfg.update(
    "useXlinkLabelIndex",
    !current,
    vscode.ConfigurationTarget.Global
  );
  vscode.window.showInformationMessage(`useXlinkLabelIndex: ${!current}`);
  update();
}

async function toggleSkipSingleIndex() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("skipSingleIndex", false);
  await cfg.update(
    "skipSingleIndex",
    !current,
    vscode.ConfigurationTarget.Global
  );
  vscode.window.showInformationMessage(`skipSingleIndex: ${!current}`);
  update();
}

async function setParent() {
  const value = await vscode.window.showInputBox({
    prompt: "Parent tag for relative XPath (leave empty for full)",
    placeHolder: "e.g., body, div, etc.",
  });
  if (value !== undefined) {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update("parentTag", value || null, vscode.ConfigurationTarget.Global);
    update();
  }
}

async function clearParent() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await cfg.update("parentTag", null, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    "Parent tag cleared — now generating full absolute XPaths."
  );
  update(); // refresh the status bar
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
      label: "Simple",
      value: { includeIndices: false, includeAttributes: false },
    },
  ];
  const pick = await vscode.window.showQuickPick(options, {
    placeHolder: "Select XPath mode",
  });
  if (pick) {
    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update("mode", pick.value, vscode.ConfigurationTarget.Global);
    update();
  }
}

async function setPreferredAttrs() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("preferredAttributes", []);
  const input = await vscode.window.showInputBox({
    prompt: "Preferred attributes (comma-separated, e.g. id,name,class)",
    value: current.join(","),
    placeHolder: "id,name,class,data-id",
  });
  if (input !== undefined) {
    const list = input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await cfg.update(
      "preferredAttributes",
      list,
      vscode.ConfigurationTarget.Global
    );
    vscode.window.showInformationMessage(
      `Preferred attributes set to: ${list.join(", ")}`
    );
    update();
  }
}

async function setIgnoreTags() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("ignoreIndexTags", []);
  const input = await vscode.window.showInputBox({
    prompt: "Tags to ignore index [1] (comma-separated)",
    value: current.join(","),
    placeHolder: "div,span,p",
  });
  if (input !== undefined) {
    const list = input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await cfg.update(
      "ignoreIndexTags",
      list,
      vscode.ConfigurationTarget.Global
    );
    update();
  }
}

async function setTemplate() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("predicateTemplate", "[@{attr1}='{attr1V}']");
  const tpl = await vscode.window.showInputBox({
    prompt:
      "Predicate template using tokens {tag},{attr1},{attr1V},{xllv},{xllvI},{idx}",
    value: current,
    placeHolder: "[@{attr1}='{attr1V}']",
  });
  if (tpl !== undefined) {
    await cfg.update(
      "predicateTemplate",
      tpl,
      vscode.ConfigurationTarget.Global
    );
    vscode.window.showInformationMessage("Predicate template set.");
    update();
  }
}

async function copyXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  try {
    const xpath = xpathBuilder.buildXPath(
      editor.document,
      editor.selection.active
    );
    if (xpath) {
      await vscode.env.clipboard.writeText(xpath);
      vscode.window.showInformationMessage(`Copied XPath: ${xpath}`);
    } else {
      vscode.window.showErrorMessage(
        "Unable to compute XPath for current position."
      );
    }
  } catch (error) {
    console.error("Error copying XPath:", error);
    vscode.window.showErrorMessage(
      "Error computing XPath. Please check the XML structure."
    );
  }
}

function update() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return statusBarItem.hide();

  // Only process XML-related files
  const xmlLanguages = ["xml", "xsl", "xsd", "wsdl", "xaml", "svg", "xhtml"];
  if (!xmlLanguages.includes(editor.document.languageId)) {
    return statusBarItem.hide();
  }

  try {
    const xpath = xpathBuilder.buildXPath(
      editor.document,
      editor.selection.active
    );
    if (xpath) {
      // Truncate very long XPaths for display
      const displayXPath =
        xpath.length > 80 ? xpath.substring(0, 77) + "..." : xpath;
      statusBarItem.text = `$(code) ${displayXPath}`;
      statusBarItem.tooltip = `XPath: ${xpath}\nClick to copy`;
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  } catch (error) {
    console.error("Error updating status bar:", error);
    statusBarItem.hide();
  }
}

module.exports = { activate, deactivate };
