// XPathBuilder.js
// Complete XPath builder with support for smart relative features:
// - smartRelativeDontIgnoreAfter: anchor tag after which all ancestors are included
// - smartRelativeAlwaysIncludeTags: array of tags always treated as landmarks
// - smartRelativeIgnoreLastElement: remove leaf when building smart-relative
// The main public method: buildXPathRegex(document, position, externalConfig)

const { XMLParser } = require("fast-xml-parser");

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
  }

  // Default configuration used when extension doesn't pass external config
  loadConfiguration() {
    return {
      parentTag: null,
      mode: { includeIndices: true, includeAttributes: true },
      preferredAttributes: [],
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
      useAttributeBasedIndexing: false,
      attributeBasedIndexingAttribute: "",
      useRelativePath: false,
      includeNamespaces: false,
      includeDefaultNamespaces: false,
      useSmartRelativePath: false,
      smartRelativeNamespacePrefix: "d",
      smartRelativeSignificantAttributes: [],
      smartRelativeIdentifyingChildren: [],
      smartRelativeSingleLine: false,
      smartRelativeVirtualRoot: "",
      smartRelativeVirtualRootMode: "include",
      smartRelativeIgnoreLastElement: false,
      // New settings
      smartRelativeDontIgnoreAfter: "",
      smartRelativeAlwaysIncludeTags: []
    };
  }

  // Public entry point: accepts vscode document & position and optional externalConfig (plain object)
  buildXPathRegex(document, position, externalConfig) {
    const xml = document.getText();
    const offset = document.offsetAt(position);
    const config = externalConfig || this.loadConfiguration();

    const events = this.tokenizeXML(xml, config);
    if (!events) return null;

    const stackResult = this.buildElementStack(events, offset, config);
    if (!stackResult || !stackResult.stack.length) return null;

    const path = this.processPath(stackResult.stack, config);
    if (!path.length) return null;

    return this.generateXPath(path, config);
  }

  // ------------ Tokenization & parsing helpers ------------

  // Tokenize XML into lightweight events (open/close/text)
  tokenizeXML(xml, config) {
    const cleanedXml = this.preprocessForTokenization(xml);
    // Matches: group1 = close slash?; group2 = tag name; group3 = attrs; group4 = self-close slash?; group5 = text content
    const tokenRegex = /<(\/)?([\w:\-\.]+)([^>]*?)(\/?)>|([^<]+)/g;
    const events = [];
    let match;

    try {
      while ((match = tokenRegex.exec(cleanedXml))) {
        if (match[5]) {
          // Text content (non-tag)
          const textContent = match[5].trim();
          if (textContent) {
            events.push({
              type: "text",
              text: textContent,
              pos: match.index
            });
          }
        } else {
          // Tag token
          const event = this.parseXMLToken(match, config);
          if (event) {
            events.push(event);
            // For self-closing tags, immediately add a close event
            if (event.type === "open" && event.selfClose) {
              events.push({ type: "close", tag: event.tag, pos: event.pos + (match[0] ? match[0].length : 0) });
            }
          }
        }
      }
      return events;
    } catch (error) {
      console.error("XML tokenization error:", error);
      return null;
    }
  }

  // Remove comments, declarations, CDATA, DOCTYPE to avoid confusing tokenization positions.
  preprocessForTokenization(xml) {
    let processed = xml;

    // Replace comments, CDATA, xml declarations, doctypes and processing instructions with same-length spaces
    processed = processed.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
    processed = processed.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (m) => " ".repeat(m.length));
    processed = processed.replace(/<\?xml[^>]*\?>/gi, (m) => " ".repeat(m.length));
    processed = processed.replace(/<!DOCTYPE[^>]*>/gi, (m) => " ".repeat(m.length));
    processed = processed.replace(/<\?[^>]*\?>/g, (m) => " ".repeat(m.length));

    return processed;
  }

  parseXMLToken(match, config) {
    // match indices:
    // [0] full match, [1] closeSlash, [2] tag, [3] attrsText, [4] selfCloseSlash, [5] text
    const fullMatch = match[0];
    const closeSlash = match[1];
    const tag = match[2];
    const attrsText = match[3] || "";
    const selfCloseSlash = match[4];
    const pos = match.index;

    if (closeSlash) {
      // close tag: set pos to end of tag for clarity
      return { type: "close", tag, pos: pos + fullMatch.length };
    }

    const attrs = this.parseAttributes(attrsText || "");
    const xlinkData = this.parseXlinkLabel(attrs, config);
    const namespaces = this.extractNamespaceInfo(attrsText || "");

    return {
      type: "open",
      tag,
      attrs,
      pos,
      selfClose: !!selfCloseSlash,
      namespaces: Object.keys(namespaces).length > 0 ? namespaces : null,
      ...xlinkData
    };
  }

  // Parse attributes string into object; handles namespaced attributes; also fix common typo xlink:lable
  parseAttributes(attrsText) {
    const attrs = {};
    const attrRegex = /([\w:\-\.]+)\s*=\s*(['"])((?:(?!\2)[^\\]|\\.)*?)\2/g;
    let match;
    while ((match = attrRegex.exec(attrsText))) {
      const attrName = match[1];
      const attrValue = match[3];
      attrs[attrName] = attrValue;
      if (attrName === "xlink:lable") {
        attrs["xlink:label"] = attrValue;
      }
    }
    return attrs;
  }

  // Parse xlink:label according to config pattern to extract numeric index
  parseXlinkLabel(attrs, config) {
    const raw = attrs["xlink:label"] || attrs["xlink:lable"];
    if (!raw) return { customIndex: undefined, customIndexRaw: undefined };

    const xlinkPattern = config?.xlinkLabelPattern || { type: "any", pattern: "" };
    let numMatch = null;

    try {
      switch (xlinkPattern.type) {
        case "startsWith":
          if (raw.startsWith(xlinkPattern.pattern)) {
            const afterPrefix = raw.substring(xlinkPattern.pattern.length);
            numMatch = afterPrefix.match(/^\d+/);
          }
          break;
        case "contains":
          if (raw.includes(xlinkPattern.pattern)) {
            const idx = raw.indexOf(xlinkPattern.pattern);
            const after = raw.substring(idx + xlinkPattern.pattern.length);
            numMatch = after.match(/^\d+/);
          }
          break;
        case "endsWith":
          if (raw.endsWith(xlinkPattern.pattern)) {
            const before = raw.substring(0, raw.length - xlinkPattern.pattern.length);
            numMatch = before.match(/\d+$/);
          }
          break;
        case "exactPrefix":
          if (raw.startsWith(xlinkPattern.pattern)) {
            const afterPrefix = raw.substring(xlinkPattern.pattern.length);
            numMatch = afterPrefix.match(/^\d+$/);
          }
          break;
        case "regex":
          try {
            const regex = new RegExp(xlinkPattern.pattern);
            const m = raw.match(regex);
            if (m) {
              if (m[1]) numMatch = [m[1]];
              else numMatch = m[0].match(/\d+/);
            }
          } catch (e) {
            console.error("Invalid xlink regex pattern:", e);
            numMatch = raw.match(/\d+/);
          }
          break;
        case "any":
        default:
          numMatch = raw.match(/\d+/);
          break;
      }
    } catch (e) {
      numMatch = raw.match(/\d+/);
    }

    const customIndex = numMatch ? parseInt(numMatch[0], 10) : undefined;
    return { customIndex, customIndexRaw: raw };
  }

  // ------------ Build element stack with indexing --------------

  buildElementStack(events, offset, config) {
    const currentStack = [];
    let targetStack = [];
    const counters = config.useParentScopedIndices ? {} : [];
    const attributeCounters = {};

    const namespaceMap = (config.includeNamespaces || config.includeDefaultNamespaces) ?
      this.buildNamespaceMap(events) : {};

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Record the stack as soon as we pass the offset (but only once)
      if (event.pos > offset && !targetStack.length) {
        targetStack = [...currentStack];
      }

      if (event.type === "open") {
        let idx;

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

        if (config.useAttributeBasedIndexing && indexingAttribute && indexingValue) {
          const depth = currentStack.length;
          const key = `${depth}-${event.tag}-${indexingAttribute}-${indexingValue}`;
          if (!attributeCounters[key]) attributeCounters[key] = 0;
          attributeCounters[key]++;
          idx = attributeCounters[key];
        } else if (config.useParentScopedIndices) {
          const parentPath = currentStack.map((e) => `${e.tag}[${e.idx}]`).join("/");
          if (!counters[parentPath]) counters[parentPath] = {};
          counters[parentPath][event.tag] = (counters[parentPath][event.tag] || 0) + 1;
          idx = counters[parentPath][event.tag];
        } else {
          const depth = currentStack.length;
          if (!counters[depth]) counters[depth] = {};
          counters[depth][event.tag] = (counters[depth][event.tag] || 0) + 1;
          idx = counters[depth][event.tag];
        }

        const preferredAttrs = [];
        if (event.attrs && config.preferredAttributes) {
          for (const attrName of config.preferredAttributes) {
            if (event.attrs[attrName]) {
              preferredAttrs.push({ name: attrName, value: event.attrs[attrName] });
            }
          }
        }

        const namespaceContext = namespaceMap[`${event.pos}-${event.tag}`] || {};

        currentStack.push({
          tag: event.tag,
          idx,
          customIndex: event.customIndex,
          customIndexRaw: event.customIndexRaw,
          attrs: event.attrs,
          indexingAttribute: indexingAttribute,
          indexingValue: indexingValue,
          preferredAttrs: preferredAttrs,
          namespaceContext: namespaceContext,
          // NEW: store index of token event to locate children for identification
          eventIndex: i,
          identifyingChildren: []
        });

      } else if (event.type === "close") {
        if (currentStack.length > 0 && currentStack[currentStack.length - 1].tag === event.tag) {
          if (event.pos >= offset && !targetStack.length) {
            targetStack = [...currentStack];
          }
          currentStack.pop();
        }
      }
    }

    // Populate identifying children for smart relative if needed
    if (config.useSmartRelativePath) {
      targetStack = this.populateIdentifyingChildren(events, targetStack, config);
    }

    if (!targetStack.length && currentStack.length > 0) {
      targetStack = [...currentStack];
    }

    return { stack: targetStack };
  }

  populateIdentifyingChildren(events, stack, config) {
    const identifyingChildElements = config.smartRelativeIdentifyingChildren && config.smartRelativeIdentifyingChildren.length > 0 ?
      config.smartRelativeIdentifyingChildren :
      ['ImageCategoryType', 'id', 'name', 'type', 'category', 'status'];

    for (let stackItem of stack) {
      stackItem.identifyingChildren = this.findIdentifyingChildren(
        events,
        stackItem.eventIndex,
        stackItem.tag,
        identifyingChildElements
      );
    }

    return stack;
  }

  // Find direct child elements of the parent and capture text for tags in identifyingTags
  findIdentifyingChildren(events, parentEventIndex, parentTag, identifyingTags) {
    const identifyingChildren = [];
    let depth = 0;
    let currentChildTag = null;
    let textContent = '';

    for (let i = parentEventIndex + 1; i < events.length; i++) {
      const event = events[i];

      if (event.type === 'open') {
        if (depth === 0) {
          currentChildTag = event.tag;
          textContent = '';
        }
        depth++;
      } else if (event.type === 'close') {
        depth--;
        if (depth === 0 && currentChildTag && identifyingTags.includes(currentChildTag)) {
          identifyingChildren.push({
            name: currentChildTag,
            value: textContent.trim()
          });
          currentChildTag = null;
          textContent = '';
        }
        if (depth < 0) {
          break;
        }
      } else if (event.type === 'text' && depth === 1 && currentChildTag && identifyingTags.includes(currentChildTag)) {
        textContent += event.text || '';
      }
    }

    return identifyingChildren;
  }

  // ------------ XPath generation helpers ------------

  generateXPathSegment(node, index, pathLength, config) {
    const isLeaf = index === pathLength - 1;

    // Apply namespace prefix if required
    let tagName = node.tag;
    if (config.includeNamespaces || config.includeDefaultNamespaces) {
      tagName = this.addNamespacePrefix(node.tag, node.namespaceContext, config);
    }

    let segment = tagName;

    // Attribute-based indexing: include all preferred attributes as predicates
    if (config.useAttributeBasedIndexing && node.preferredAttrs && node.preferredAttrs.length > 0) {
      for (const attr of node.preferredAttrs) {
        const escapedValue = this.escapeAttributeValue(attr.value);
        segment += `[@${attr.name}='${escapedValue}']`;
      }
    } else {
      if (node.preferredAttrs && node.preferredAttrs.length > 0 && config.mode?.includeAttributes) {
        const attr = node.preferredAttrs[0];
        const escapedValue = this.escapeAttributeValue(attr.value);
        segment += `[@${attr.name}='${escapedValue}']`;
      }
    }

    segment += this.generateIndex(node, isLeaf, config);
    return segment;
  }

  selectPreferredAttribute(attrs, preferredList = []) {
    for (const preferred of preferredList) {
      if (attrs[preferred]) return { attrName: preferred, attrValue: attrs[preferred] };
    }
    return { attrName: null, attrValue: null };
  }

  processPath(stack, config) {
    let path = stack;
    if (config.parentTag) {
      const parentIndex = stack.findIndex((n) => n.tag === config.parentTag);
      if (parentIndex >= 0) path = stack.slice(parentIndex);
    }
    if (config.parentTag && config.ignoreParentSegment && path.length) {
      path = path.slice(1);
    }
    return path;
  }

  // Top-level generateXPath chooses smart, relative, or absolute based on config
  generateXPath(path, config) {
    if (!path || path.length === 0) return "";

    // Smart relative takes highest precedence
    if (config.useSmartRelativePath) {
      return this.generateSmartRelativeXPath(path, config);
    }

    if (config.useRelativePath) {
      return this.generateRelativeXPath(path, config);
    }

    const segments = path.map((node, index) =>
      this.generateXPathSegment(node, index, path.length, config)
    );
    return "/" + segments.join("/");
  }

  escapeAttributeValue(value) {
    if (value === undefined || value === null) return "";
    return String(value).replace(/'/g, "&apos;");
  }

  generateAttributePredicate(node, config) {
    if (!node.attrName || !node.attrValue || !config.mode?.includeAttributes) return "";

    if (config.predicateTemplate) {
      const escapedValue = this.escapeAttributeValue(node.attrValue);
      let predicate = config.predicateTemplate;
      const self = this;

      predicate = predicate.replace(/{at}/g, "@");
      predicate = predicate.replace(/{tag}/g, node.tag || "");
      predicate = predicate.replace(/{attr1}/g, node.attrName || "");
      predicate = predicate.replace(/{attr1V}/g, escapedValue);
      predicate = predicate.replace(/{idx}/g, node.idx);

      if (node.attrs) {
        predicate = predicate.replace(/{attr:(\w+)}/g, (match, attrName) => {
          return node.attrs[attrName] ? self.escapeAttributeValue(node.attrs[attrName]) : "";
        });

        if (predicate.includes("{attrs}")) {
          const allAttrs = Object.entries(node.attrs)
            .map(([k, v]) => `@${k}='${self.escapeAttributeValue(v)}'`)
            .join(" and ");
          predicate = predicate.replace(/{attrs}/g, allAttrs);
        }

        predicate = predicate.replace(/{attrCount}/g, Object.keys(node.attrs).length);
      }

      predicate = predicate.replace(/{pos}/g, node.idx);
      predicate = predicate.replace(/{lastPos}/g, `last()`);
      predicate = predicate.replace(/{isFirst}/g, node.idx === 1 ? "true()" : "false()");
      predicate = predicate.replace(/{isLast}/g, `position()=last()`);

      if (node.customIndex !== undefined) {
        predicate = predicate.replace(/{xllv}/g, node.customIndexRaw || "");
        predicate = predicate.replace(/{xllvI}/g, node.customIndex);
      }

      predicate = predicate.replace(/{attr1Lower}/g, (node.attrName || "").toLowerCase());
      predicate = predicate.replace(/{attr1Upper}/g, (node.attrName || "").toUpperCase());
      predicate = predicate.replace(/{attr1VLower}/g, (escapedValue || "").toLowerCase());
      predicate = predicate.replace(/{attr1VUpper}/g, (escapedValue || "").toUpperCase());

      predicate = predicate.replace(
        /{if:([^:]+):([^:]+):([^}]+)}/g,
        (match, condition, ifTrue, ifFalse) => {
          if (condition === "hasId") return node.attrs?.id ? ifTrue : ifFalse;
          if (condition === "hasClass") return node.attrs?.class ? ifTrue : ifFalse;
          if (condition === "isFirst") return node.idx === 1 ? ifTrue : ifFalse;
          return ifFalse;
        }
      );

      return predicate;
    }

    const escapedValue = this.escapeAttributeValue(node.attrValue);
    return `[@${node.attrName}='${escapedValue}']`;
  }

  generateIndex(node, isLeaf, config) {
    if (!config.mode?.includeIndices || (isLeaf && config.disableLeafIndex)) return "";

    const index = (config.useXlinkLabelIndex && node.customIndex != null) ? node.customIndex : node.idx;

    // Exceptions handling
    if (
      index === 1 &&
      config.exceptionsToIndexOneForcing &&
      config.exceptionsToIndexOneForcing.has &&
      config.exceptionsToIndexOneForcing.has(node.tag)
    ) {
      return "";
    }

    if (index === 1) {
      if (config.skipSingleIndex) {
        if (config.forceIndexOneFor && config.forceIndexOneFor.has && config.forceIndexOneFor.has(node.tag)) {
          return "[1]";
        }
        if (config.ignoreTags && config.ignoreTags.has && config.ignoreTags.has(node.tag)) {
          return "";
        }
        return "";
      } else {
        if (!config.forceIndexOneFor || (config.forceIndexOneFor.size === 0)) {
          return "[1]";
        }
        if (config.forceIndexOneFor.has && config.forceIndexOneFor.has(node.tag)) {
          return "[1]";
        }
        if (config.ignoreTags && config.ignoreTags.has && config.ignoreTags.has(node.tag)) {
          return "";
        }
        return "";
      }
    }

    return `[${index}]`;
  }

  // Extract namespace declarations from attribute text (returns map prefix->uri)
  extractNamespaceInfo(attrsText) {
    const namespaces = {};
    const xmlnsRegex = /xmlns(?::([^=\s]+))?\s*=\s*(['"])((?:(?!\2)[^\\]|\\.)*?)\2/g;
    let match;
    while ((match = xmlnsRegex.exec(attrsText))) {
      const prefix = match[1] || "default";
      const uri = match[3];
      namespaces[prefix] = uri;
    }
    return namespaces;
  }

  // Build namespace map across document using events
  buildNamespaceMap(events) {
    const namespaceMap = {};
    const stack = [];

    for (const event of events) {
      if (event.type === "open") {
        const currentContext = stack.length > 0 ? { ...stack[stack.length - 1].namespaces } : {};
        if (event.namespaces) {
          Object.assign(currentContext, event.namespaces);
        }
        stack.push({ tag: event.tag, namespaces: currentContext });
        namespaceMap[`${event.pos}-${event.tag}`] = currentContext;
      } else if (event.type === "close") {
        if (stack.length > 0 && stack[stack.length - 1].tag === event.tag) {
          stack.pop();
        }
      }
    }
    return namespaceMap;
  }

  resolveNamespacePrefix(tagName, namespaceContext) {
    if (!tagName.includes(":")) {
      return { prefix: null, localName: tagName, namespace: namespaceContext?.default };
    }
    const colonIndex = tagName.indexOf(":");
    const prefix = tagName.substring(0, colonIndex);
    const localName = tagName.substring(colonIndex + 1);
    const namespace = namespaceContext ? namespaceContext[prefix] : undefined;
    return { prefix, localName, namespace };
  }

  // Add namespace prefix if configured. For default namespace, returns local-name test.
  addNamespacePrefix(tagName, namespaceContext, config) {
    if (!config.includeNamespaces) return tagName;

    const nsInfo = this.resolveNamespacePrefix(tagName, namespaceContext || {});

    if (nsInfo.prefix) {
      return tagName;
    }

    if (config.includeDefaultNamespaces && nsInfo.namespace) {
      for (const [prefix, uri] of Object.entries(namespaceContext || {})) {
        if (uri === nsInfo.namespace && prefix !== "default") {
          return `${prefix}:${nsInfo.localName}`;
        }
      }
      if (nsInfo.namespace && namespaceContext?.default === nsInfo.namespace) {
        return `*[local-name()='${nsInfo.localName}']`;
      }
    }

    return tagName;
  }

  // Simple relative generation (//)
  generateRelativeXPath(path, config) {
    if (!path || path.length === 0) return "";
    const segments = path.map((node, index) =>
      this.generateXPathSegment(node, index, path.length, config)
    );
    return "//" + segments.join("/");
  }

  // Find significant ancestor index using configured attributes
  findSignificantAncestor(stack, config) {
    if (!config.smartRelativeSignificantAttributes || config.smartRelativeSignificantAttributes.length === 0) {
      return -1;
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      const element = stack[i];
      if (element.attrs) {
        for (const sigAttr of config.smartRelativeSignificantAttributes) {
          if (element.attrs[sigAttr]) {
            return i;
          }
        }
      }
    }
    return -1;
  }

  // Return true if a tag is in the always-include list
  hasAlwaysIncludeTag(tag, config) {
    if (!config || !config.smartRelativeAlwaysIncludeTags) return false;
    return Array.isArray(config.smartRelativeAlwaysIncludeTags) && config.smartRelativeAlwaysIncludeTags.includes(tag);
  }

  // Smart relative generator honoring:
  // - smartRelativeIgnoreLastElement (remove leaf before processing)
  // - smartRelativeDontIgnoreAfter (anchor: include all elements after it)
  // - smartRelativeAlwaysIncludeTags (always include)
  generateSmartRelativeXPath(path, config) {
    if (!path || path.length === 0) return "";

    const prefix = config.smartRelativeNamespacePrefix || "d";
    const landmarks = [];

    // Work on a copy, respecting ignore-last-element
    let effectivePath = path;
    if (config.smartRelativeIgnoreLastElement && path.length > 1) {
      effectivePath = path.slice(0, -1);
    }

    // Determine anchor index if requested
    const dontIgnoreAfterTag = config.smartRelativeDontIgnoreAfter || "";
    let dontIgnoreAfterIndex = -1;
    if (dontIgnoreAfterTag) {
      dontIgnoreAfterIndex = effectivePath.findIndex((n) => n.tag === dontIgnoreAfterTag);
    }

    // Virtual root handling
    let startIndex = 0;
    let hasVirtualRoot = false;

    if (config.smartRelativeVirtualRoot) {
      let virtualRootIndex = -1;
      for (let i = 0; i < effectivePath.length; i++) {
        if (effectivePath[i].tag === config.smartRelativeVirtualRoot) {
          virtualRootIndex = i;
          break;
        }
      }

      if (virtualRootIndex >= 0) {
        hasVirtualRoot = true;
        if (config.smartRelativeVirtualRootMode === "include") {
          // include virtual root as first landmark and start after it
          landmarks.push({
            element: effectivePath[virtualRootIndex],
            isRoot: true,
            isVirtualRoot: true,
            isTarget: false
          });
          startIndex = virtualRootIndex + 1;
        } else {
          startIndex = virtualRootIndex + 1;
        }
      } else {
        // fallback: use document root
        if (effectivePath.length > 0) {
          landmarks.push({
            element: effectivePath[0],
            isRoot: true,
            isVirtualRoot: false,
            isTarget: false
          });
          startIndex = 1;
        }
      }
    } else {
      if (effectivePath.length > 0) {
        landmarks.push({
          element: effectivePath[0],
          isRoot: true,
          isVirtualRoot: false,
          isTarget: false
        });
        startIndex = 1;
      }
    }

    // Collect landmarks:
    for (let i = startIndex; i < effectivePath.length - 1; i++) {
      const element = effectivePath[i];

      const isAfterAnchor = (dontIgnoreAfterIndex >= 0 && i >= dontIgnoreAfterIndex);
      const alwaysInclude = this.hasAlwaysIncludeTag(element.tag, config);

      if (isAfterAnchor || alwaysInclude || this.hasSignificantAttributes(element, config) || this.hasIdentifyingChildren(element, config)) {
        landmarks.push({
          element: element,
          isRoot: false,
          isVirtualRoot: false,
          isTarget: false
        });
      }
    }

    // Add target element if present in effectivePath (note: if ignore-last-element was set, the original leaf is removed)
    if (effectivePath.length > startIndex) {
      const targetElement = effectivePath[effectivePath.length - 1];
      landmarks.push({
        element: targetElement,
        isRoot: false,
        isVirtualRoot: false,
        isTarget: true
      });
    } else if (effectivePath.length > 0 && startIndex === effectivePath.length) {
      if (landmarks.length > 0) landmarks[landmarks.length - 1].isTarget = true;
    }

    if (config.smartRelativeSingleLine) {
      return this.generateSingleLineSmartXPath(landmarks, config, prefix, hasVirtualRoot);
    } else {
      return this.generateMultiLineSmartXPath(landmarks, config, prefix, hasVirtualRoot);
    }
  }

  // Single-line formatting for smart relative mode
  generateSingleLineSmartXPath(landmarks, config, prefix, hasVirtualRoot = false) {
    const segments = [];

    for (const landmark of landmarks) {
      const element = landmark.element;
      let segment = prefix ? `${prefix}:${element.tag}` : element.tag;

      if (config.useAttributeBasedIndexing && element.attrs && config.attributeBasedIndexingAttribute && element.attrs[config.attributeBasedIndexingAttribute]) {
        const attrName = config.attributeBasedIndexingAttribute;
        const attrValue = element.attrs[attrName];
        const escapedValue = this.escapeAttributeValue(attrValue);
        segment += `[@${attrName}='${escapedValue}']`;
        const index = element.idx || element.index;
        if (index > 1 || (index === 1 && !config.skipSingleIndex)) {
          segment += `[${index}]`;
        }
      } else {
        const identifier = this.getElementIdentifier(element, config, prefix);
        if (identifier) {
          segment += identifier;
        } else if (landmark.isTarget) {
          segment += this.generateIndex(element, true, config);
        }
      }

      segments.push(segment);
    }

    if (hasVirtualRoot) {
      return "//" + segments.join("//");
    } else {
      if (segments.length === 1) {
        return "/" + segments[0];
      } else {
        return "/" + segments.join("/");
      }
    }
  }

  // Multi-line formatting for smart relative mode
  generateMultiLineSmartXPath(landmarks, config, prefix, hasVirtualRoot = false) {
    let result = "";
    const indent = " ".repeat(config.smartRelativeIndentSize || 4);

    for (let i = 0; i < landmarks.length; i++) {
      const landmark = landmarks[i];
      const element = landmark.element;
      let segment = prefix ? `${prefix}:${element.tag}` : element.tag;

      if (config.useAttributeBasedIndexing && element.attrs && config.attributeBasedIndexingAttribute && element.attrs[config.attributeBasedIndexingAttribute]) {
        const attrName = config.attributeBasedIndexingAttribute;
        const attrValue = element.attrs[attrName];
        const escapedValue = this.escapeAttributeValue(attrValue);
        segment += `[@${attrName}='${escapedValue}']`;
        const index = element.idx || element.index;
        if (index > 1 || (index === 1 && !config.skipSingleIndex)) {
          segment += `[${index}]`;
        }
      } else {
        const identifier = this.getElementIdentifier(element, config, prefix);
        if (identifier) {
          segment += identifier;
        } else if (landmark.isTarget) {
          segment += this.generateIndex(element, true, config);
        }
      }

      if (hasVirtualRoot) {
        if (i === 0) {
          result += `//${segment}`;
        } else {
          result += `\n${indent}//${segment}`;
        }
      } else {
        if (i === 0) {
          result += `/${segment}`;
        } else {
          result += `/${segment}`;
        }
      }
    }

    return result;
  }

  // Return attribute-based identifier or identifying-child pseudo-attribute
  getElementIdentifier(element, config, prefix) {
    const sigAttr = this.findSignificantAttribute(element, config);
    if (sigAttr) {
      const escapedValue = this.escapeAttributeValue(sigAttr.value);
      let identifier = `[@${sigAttr.name}='${escapedValue}']`;

      if (config.useAttributeBasedIndexing && config.attributeBasedIndexingAttribute === sigAttr.name) {
        const index = element.idx || element.index;
        if (index && index > 1) {
          identifier += `[${index}]`;
        } else if (index === 1 && !config.skipSingleIndex) {
          identifier += `[1]`;
        }
      }

      return identifier;
    }

    if (element.identifyingChildren && element.identifyingChildren.length > 0) {
      const child = element.identifyingChildren[0];
      const escapedValue = this.escapeAttributeValue(child.value);
      return `[@${prefix}:${child.name}='${escapedValue}']`;
    }

    return null;
  }

  hasIdentifyingChildren(element, config) {
    return element.identifyingChildren && element.identifyingChildren.length > 0;
  }

  hasSignificantAttributes(element, config) {
    if (!element.attrs || !config.smartRelativeSignificantAttributes) return false;
    for (const sigAttr of config.smartRelativeSignificantAttributes) {
      if (element.attrs[sigAttr]) return true;
    }
    return false;
  }

  findSignificantAttribute(element, config) {
    if (!element.attrs || !config.smartRelativeSignificantAttributes) return null;
    for (const sigAttr of config.smartRelativeSignificantAttributes) {
      if (element.attrs[sigAttr]) {
        return { name: sigAttr, value: element.attrs[sigAttr] };
      }
    }
    if (element.preferredAttrs && element.preferredAttrs.length > 0) {
      return element.preferredAttrs[0];
    }
    return null;
  }
}

module.exports = XPathBuilder;
