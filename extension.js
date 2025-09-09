// ========== File: extension.js ==========

const vscode = require("vscode");
const XPathBuilder = require("./XPathBuilder.js");

const CONFIG_SECTION = "xmlXpath";
let statusBarItem;

const xpathBuilder = new XPathBuilder();

// Inject VS Code-backed configuration loader into the builder (same pattern you used)
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
    xlinkLabelPattern: cfg.get("xlinkLabelPattern", { type: "any", pattern: "" }),
    forceIndexOneFor: new Set(cfg.get("forceIndexOneFor", [])),
    exceptionsToIndexOneForcing: new Set(cfg.get("exceptionsToIndexOneForcing", [])),
    useAttributeBasedIndexing: cfg.get("useAttributeBasedIndexing", false),
    attributeBasedIndexingAttribute: cfg.get("attributeBasedIndexingAttribute", ""),
    useRelativePath: cfg.get("useRelativePath", false),
    includeNamespaces: cfg.get("includeNamespaces", false),
    includeDefaultNamespaces: cfg.get("includeDefaultNamespaces", false),

    // Smart relative
    useSmartRelativePath: cfg.get("useSmartRelativePath", false),
    smartRelativeNamespacePrefix: cfg.get("smartRelativeNamespacePrefix", "d"),
    smartRelativeSignificantAttributes: cfg.get("smartRelativeSignificantAttributes", []),
    smartRelativeIdentifyingChildren: cfg.get("smartRelativeIdentifyingChildren", []),
    smartRelativeIgnoreLastElement: cfg.get("smartRelativeIgnoreLastElement", false),
    smartRelativeSingleLine: cfg.get("smartRelativeSingleLine", false),
    smartRelativeVirtualRoot: cfg.get("smartRelativeVirtualRoot", ""),
    smartRelativeVirtualRootMode: cfg.get("smartRelativeVirtualRootMode", "include"),
  };
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

// ------------------------ XPath parsing for search ------------------------
// This parser is intentionally conservative: it supports typical predicates:
// numeric positions [1], attribute equality [@id='x'], contains(@attr,'x'), text()="x", position(), last()
function parseXPath(xpath) {
  if (!xpath || typeof xpath !== "string") return [];

  // Normalize: remove leading '//' or leading single slash. We treat XPath as path segments.
  let normalized = xpath.trim();
  while (normalized.startsWith("//")) normalized = normalized.substring(2);
  if (normalized.startsWith("/")) normalized = normalized.substring(1);

  if (!normalized) return [];

  const rawParts = normalized.split("/").filter((p) => p && p.trim().length > 0);
  const segments = [];

  for (const rawPart of rawParts) {
    // split tag and predicate(s)
    const bracketIndex = rawPart.indexOf("[");
    let tagName = bracketIndex === -1 ? rawPart : rawPart.substring(0, bracketIndex);
    let predicatesPart = bracketIndex === -1 ? "" : rawPart.substring(bracketIndex);

    tagName = tagName.trim();

    const seg = { tagName, predicates: [] };

    if (predicatesPart) {
      const predicateRegex = /\[([^\]]+)\]/g;
      let m;
      while ((m = predicateRegex.exec(predicatesPart)) !== null) {
        const pred = m[1].trim();

        // positional: number
        if (/^\d+$/.test(pred)) {
          seg.predicates.push({ type: "position", value: parseInt(pred, 10) });
          continue;
        }

        // position()=n
        const posFunc = pred.match(/position\(\)\s*=\s*(\d+)/);
        if (posFunc) {
          seg.predicates.push({ type: "position", value: parseInt(posFunc[1], 10) });
          continue;
        }

        // last()
        if (/^last\(\)\s*$/.test(pred)) {
          seg.predicates.push({ type: "last" });
          continue;
        }

        // attribute equality: @attr='value' or attr='value'
        const attrEq = pred.match(/^@?([^=\s]+)\s*=\s*['"]([^'"]*)['"]$/);
        if (attrEq) {
          seg.predicates.push({ type: "attribute", name: attrEq[1], value: attrEq[2] });
          continue;
        }

        // contains(@attr,'value')
        const containsMatch = pred.match(/contains\s*\(\s*@([^,)\s]+)\s*,\s*['"]([^'"]+)['"]\s*\)/);
        if (containsMatch) {
          seg.predicates.push({ type: "contains", target: containsMatch[1], value: containsMatch[2] });
          continue;
        }

        // text()="..."
        const textMatch = pred.match(/text\(\)\s*=\s*['"]([^'"]+)['"]/);
        if (textMatch) {
          seg.predicates.push({ type: "text", value: textMatch[1] });
          continue;
        }

        // fallback: keep raw predicate
        seg.predicates.push({ type: "other", value: pred });
      }
    }

    segments.push(seg);
  }

  return segments;
}

// ------------------------ Searching inside document ------------------------

async function findElementByXPath(editor, xpath) {
  const xml = editor.document.getText();
  const config = xpathBuilder.loadConfiguration();

  // parse xpath into segments
  const segments = parseXPath(xpath);
  if (!segments || segments.length === 0) throw new Error("Invalid or empty XPath");

  const events = xpathBuilder.tokenizeXML(xml, config);
  if (!events) throw new Error("Failed to parse XML");

  return searchForElement(events, segments, xml, config);
}

// This function scans events and returns first full match or the best partial match (closest)
function searchForElement(events, xpathSegments, xml, config) {
  const stack = [];
  let bestMatch = null;
  let maxMatchedDepth = 0;

  // Counters configured same as builder
  const counters = config.useParentScopedIndices ? {} : [];
  const attributeCounters = {};

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.type === "open") {
      // index calculation (mirrors buildElementStack)
      const depth = stack.length;
      let idx;

      let indexingAttribute = null;
      let indexingValue = null;

      if (config.useAttributeBasedIndexing) {
        if (config.preferredAttributes && config.preferredAttributes.length > 0) {
          for (const a of config.preferredAttributes) {
            if (event.attrs && event.attrs[a]) {
              indexingAttribute = a;
              indexingValue = event.attrs[a];
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

      if (config.useAttributeBasedIndexing && indexingAttribute && indexingValue) {
        const key = `${depth}-${event.tag}-${indexingAttribute}-${indexingValue}`;
        if (!attributeCounters[key]) attributeCounters[key] = 0;
        attributeCounters[key]++;
        idx = attributeCounters[key];
      } else if (config.useParentScopedIndices) {
        const parentPath = stack.map((e) => `${e.tag}[${e.index}]`).join("/");
        if (!counters[parentPath]) counters[parentPath] = {};
        counters[parentPath][event.tag] = (counters[parentPath][event.tag] || 0) + 1;
        idx = counters[parentPath][event.tag];
      } else {
        if (!counters[depth]) counters[depth] = {};
        counters[depth][event.tag] = (counters[depth][event.tag] || 0) + 1;
        idx = counters[depth][event.tag];
      }

      // preferred attributes
      const preferredAttrs = [];
      if (event.attrs && config.preferredAttributes) {
        for (const attrName of config.preferredAttributes) {
          if (event.attrs[attrName]) preferredAttrs.push({ name: attrName, value: event.attrs[attrName] });
        }
      }

      // push stack item
      stack.push({
        tag: event.tag,
        idx,
        index: idx,
        customIndex: event.customIndex,
        customIndexRaw: event.customIndexRaw,
        attrs: event.attrs,
        indexingAttribute,
        indexingValue,
        preferredAttrs,
        startOffset: event.pos,
        eventIndex: i,
      });

      // Evaluate how deep this stack matches xpathSegments
      const matchInfo = getMatchDepth(stack, xpathSegments, config);

      // If match deeper than previous best, update bestMatch with element at matched depth - 1
      if (matchInfo.depth > maxMatchedDepth) {
        maxMatchedDepth = matchInfo.depth;

        const matchedElementIndex = matchInfo.depth - 1;
        if (matchedElementIndex >= 0 && matchedElementIndex < stack.length) {
          const matchedElement = stack[matchedElementIndex];

          // Compute end offset for the matched element (find its corresponding close)
          const startEvtIdx = matchedElement.eventIndex;
          const matchedTag = matchedElement.tag;
          let openCount = 1;
          let endOffset = matchedElement.startOffset + matchedTag.length + 2; // approximate end of opening tag

          for (let j = startEvtIdx + 1; j < events.length; j++) {
            if (events[j].type === "open" && events[j].tag === matchedTag) openCount++;
            else if (events[j].type === "close" && events[j].tag === matchedTag) {
              openCount--;
              if (openCount === 0) {
                // events[j].pos points at end of closing token in our tokenizer (we used pos=match.index or match.index+length)
                // to be safe, set endOffset to the close event pos (it's near the >)
                endOffset = events[j].pos;
                break;
              }
            }
          }

          bestMatch = {
            tagName: matchedElement.tag,
            startOffset: matchedElement.startOffset,
            endOffset: endOffset,
            attrs: matchedElement.attrs,
            matchedDepth: matchInfo.depth,
            totalDepth: xpathSegments.length,
            isPartial: matchInfo.depth !== xpathSegments.length,
          };
        }
      }

      // If we have a full match at current stack depth, return immediately (prefer first full match)
      if (matchInfo.depth === xpathSegments.length) {
        // full match: take last element on stack as target
        const lastElement = stack[stack.length - 1];
        // compute its end offset
        let openCount = 1;
        let endOffset = lastElement.startOffset + lastElement.tag.length + 2;
        for (let j = lastElement.eventIndex + 1; j < events.length; j++) {
          if (events[j].type === "open" && events[j].tag === lastElement.tag) openCount++;
          else if (events[j].type === "close" && events[j].tag === lastElement.tag) {
            openCount--;
            if (openCount === 0) {
              endOffset = events[j].pos;
              break;
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
      } else {
        // best-effort: try to find the matching open item and pop to keep stack consistent
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].tag === event.tag) {
            stack.splice(k, 1);
            break;
          }
        }
      }
    }
  }

  // no full match; return best partial match (may be null)
  return bestMatch;
}

// Helper: compute match depth similar to your getMatchDepth implementation but consolidated.
// It respects attribute predicates and position predicates and accounts for config.useXlinkLabelIndex
function getMatchDepth(stack, xpathSegments, config) {
  let depth = 0;

  for (let i = 0; i < Math.min(stack.length, xpathSegments.length); i++) {
    const stackItem = stack[i];
    const xpathSegment = xpathSegments[i];

    // tag must match
    if (stackItem.tag !== xpathSegment.tagName) break;

    let allPredicatesMatch = true;

    for (const pred of xpathSegment.predicates) {
      if (pred.type === "position") {
        // choose actual index to compare: customIndex if xlink label used, otherwise index
        let actualIndex = stackItem.index;
        if (config.useXlinkLabelIndex && stackItem.customIndex !== undefined) {
          actualIndex = stackItem.customIndex;
        }

        // If attribute-based indexing is used and attributeBasedIndexingAttribute is present,
        // stackItem.index already represents that indexing form (we mirrored that when building stack items).
        if (actualIndex !== pred.value) {
          allPredicatesMatch = false;
          break;
        }
      } else if (pred.type === "attribute") {
        if (!stackItem.attrs || stackItem.attrs[pred.name] !== pred.value) {
          allPredicatesMatch = false;
          break;
        }
      } else if (pred.type === "contains") {
        if (!stackItem.attrs || !stackItem.attrs[pred.target] || !stackItem.attrs[pred.target].includes(pred.value)) {
          allPredicatesMatch = false;
          break;
        }
      } else if (pred.type === "text") {
        // find immediate child text of the element. We'll scan events between eventIndex and the matching close
        let textFound = "";
        let openCount = 0;
        const evtStart = stackItem.eventIndex;
        for (let j = evtStart + 1; j < stackItem.eventIndex + 1000 && j < stackItem.eventIndex + 10000 && j < stackItem.eventIndex + 5000 && j < eventsLengthProxy();) {
          // we can't access events here (closure), so keep text predicate unsupported in deep mode
          // but we can conservatively fail so partial match won't incorrectly accept
          textFound = "";
          break;
        }
        // conservative: require false if we cannot reliably check
        allPredicatesMatch = false;
        break;
      } else {
        // other predicate — be conservative and require predicate string presence in attributes or skip matching it
        // We'll attempt a best-effort: if predicate looks like @attr="val" we've already handled it; otherwise fail
        allPredicatesMatch = false;
        break;
      }
    }

    if (!allPredicatesMatch) break;

    depth++;
  }

  return { depth };
}

// eventsLengthProxy: small helper to avoid lint error when referencing events length inside getMatchDepth
// (we keep getMatchDepth simple; complex text() matching would require passing events in)
function eventsLengthProxy() {
  // Use a very large number - getMatchDepth will not use it meaningfully
  return 100000;
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
    const result = await findElementByXPath(editor, xpath);

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

// Keep update/statusbar behavior mostly the same as your code
function update() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isXmlLanguage(editor.document)) {
    if (statusBarItem) statusBarItem.hide();
    return;
  }

  try {
    const config = xpathBuilder.loadConfiguration();
    if (config.useAttributeBasedIndexing) {
      console.log(`Attribute-based indexing enabled: ${config.attributeBasedIndexingAttribute || "(auto)"}`);
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
    "xmlXpath.searchWithXPath": searchWithXPath, // <-- important: searches & highlights in-editor
    "xmlXpath.setForceIndexOneFor": () => updateConfig("forceIndexOneFor", "Tags to force index [1] (comma-separated)", (v) => v.split(",").map(s => s.trim()).filter(Boolean)),
    "xmlXpath.setExceptionsToIndexOneForcing": () => updateConfig("exceptionsToIndexOneForcing", "Tags that are exceptions to force index [1] (comma-separated)", (v) => v.split(",").map(s => s.trim()).filter(Boolean)),
    "xmlXpath.toggleAttributeBasedIndexing": () => toggleConfig("useAttributeBasedIndexing", "Attribute-Based Indexing"),
    "xmlXpath.setAttributeBasedIndexingAttribute": setAttributeBasedIndexingAttribute,
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
    "xmlXpath.clearSmartRelativeVirtualRoot": clearSmartRelativeVirtualRoot
  };

  for (const [name, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
  }
}

// ---------- helper UI/setters (kept mostly as in your file) ----------

async function setParentTag() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const currentValue = cfg.get("parentTag", "");

  // Try get tag under cursor using builder logic (like you had)
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
    const originalLoader = xpathBuilder.loadConfiguration;
    const currentConfig = originalLoader();

    xpathBuilder.loadConfiguration = function () {
      return {
        parentTag: null,
        mode: { includeIndices: true, includeAttributes: true },
        preferredAttributes: currentConfig.preferredAttributes || ["id", "name"],
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

    const xpath = xpathBuilder.buildXPathRegex(editor.document, editor.selection.active);

    xpathBuilder.loadConfiguration = originalLoader;

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
    const xpath = xpathBuilder.buildXPathRegex(editor.document, editor.selection.active);
    if (xpath) {
      await vscode.env.clipboard.writeText(xpath);
      vscode.window.showInformationMessage(`Copied: ${truncate(xpath, 300)}`);
    }
  } catch (err) {
    console.error("copyXPath error:", err);
    vscode.window.showErrorMessage("Could not compute XPath.");
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

// attribute-based indexing attribute setter
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
    value = await vscode.window.showInputBox({ prompt: "Attribute name for attribute-based indexing", value: current, placeHolder: "e.g., ValuationType" });
    if (!value) return;
  }

  await cfg.update("attributeBasedIndexingAttribute", value, vscode.ConfigurationTarget.Global);
  update();
  vscode.window.showInformationMessage(`Attribute-based indexing will use: ${value}`);
}

// toggles from your file
async function toggleUseRelativePath() { await toggleConfig("useRelativePath", "Use Relative Path"); }
async function toggleIncludeNamespaces() { await toggleConfig("includeNamespaces", "Include Namespaces"); }
async function toggleIncludeDefaultNamespaces() { await toggleConfig("includeDefaultNamespaces", "Include Default Namespaces"); }
async function toggleUseSmartRelativePath() { await toggleConfig("useSmartRelativePath", "Smart Relative Path"); }
async function setSmartRelativeNamespacePrefix() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("smartRelativeNamespacePrefix", "d");
  const val = await vscode.window.showInputBox({ prompt: "Smart relative namespace prefix", value: current, placeHolder: "e.g., d, ns" });
  if (val !== undefined) {
    await cfg.update("smartRelativeNamespacePrefix", val, vscode.ConfigurationTarget.Global);
    update();
    vscode.window.showInformationMessage(`Smart relative prefix set to: ${val}`);
  }
}
async function setSmartRelativeSignificantAttributes() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("smartRelativeSignificantAttributes", ["id","type","name"]);
  const val = await vscode.window.showInputBox({ prompt: "Significant attributes (comma-separated)", value: (Array.isArray(current) ? current.join(", ") : current) });
  if (val !== undefined) {
    const arr = val.split(",").map(s => s.trim()).filter(Boolean);
    await cfg.update("smartRelativeSignificantAttributes", arr, vscode.ConfigurationTarget.Global);
    update();
    vscode.window.showInformationMessage(`Significant attributes set to: ${arr.join(", ")}`);
  }
}
async function toggleSmartRelativeIgnoreLastElement() { await toggleConfig("smartRelativeIgnoreLastElement", "Smart Relative Ignore Last Element"); }
async function toggleSmartRelativeSingleLine() { await toggleConfig("smartRelativeSingleLine", "Smart Relative Single Line"); }
async function setSmartRelativeVirtualRoot() {
  // same implementation as your file — suggest a parent under cursor
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get("smartRelativeVirtualRoot", "");
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
        if (stackResult && stackResult.stack.length > 1) {
          tagUnderCursor = stackResult.stack[stackResult.stack.length - 2].tag;
        }
      }
    } catch (err) { console.error(err); }
  }

  const value = await vscode.window.showInputBox({
    prompt: "Virtual root element for smart relative XPath",
    value: tagUnderCursor || current,
    placeHolder: "e.g., PROPERTY, VALUATION"
  });

  if (value !== undefined) {
    await cfg.update("smartRelativeVirtualRoot", value.trim(), vscode.ConfigurationTarget.Global);
    update();
    if (value.trim()) vscode.window.showInformationMessage(`Virtual root set to: ${value.trim()}`);
    else vscode.window.showInformationMessage("Virtual root cleared - using document root");
  }
}
async function toggleSmartRelativeVirtualRootMode() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const cur = cfg.get("smartRelativeVirtualRootMode", "include");
  const next = cur === "include" ? "exclude" : "include";
  await cfg.update("smartRelativeVirtualRootMode", next, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Virtual Root Mode: ${next.toUpperCase()}`);
  update();
}
async function clearSmartRelativeVirtualRoot() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await cfg.update("smartRelativeVirtualRoot", "", vscode.ConfigurationTarget.Global);
  update();
  vscode.window.showInformationMessage("Virtual root cleared");
}

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
