// ========== File: XPathBuilder.js (Updated: explicit-empty disables identifying children; relative-mode enhancements) ==========
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

  // Default configuration values
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

      // Smart-relative existing:
      useSmartRelativePath: false,
      smartRelativeNamespacePrefix: "d",
      smartRelativeSignificantAttributes: [],
      // if undefined -> fallback defaults; if [] -> explicit disable
      smartRelativeIdentifyingChildren: undefined,
      smartRelativeSingleLine: false,
      smartRelativeVirtualRoot: "",
      smartRelativeVirtualRootMode: "include",
      smartRelativeIgnoreLastElement: false,
      smartRelativeAlwaysIncludeTags: [],
      smartRelativeDontIgnoreAfter: "",
      smartRelativeLandmarkMode: true,
      smartRelativeIndentSize: 4,

      // NEW: Relative mode / general options (mirror smart-relative capabilities)
      relativeMustIncludeTags: [],
      relativeMustIgnoreTags: [],
      relativeDontIgnoreAfter: "",
      relativeNamespacePrefix: "d",
    };
  }

  // buildXPathRegex: now accepts optional config overrides (from workspace settings)
  buildXPathRegex(document, position, configOverride = {}) {
    const xml = document.getText();
    const offset = document.offsetAt(position);

    // Merge configurations
    const baseConfig = this.loadConfiguration();
    const config = { ...baseConfig, ...(configOverride || {}) };

    // Convert certain array-based settings into Sets where needed
    if (Array.isArray(config.ignoreTags)) config.ignoreTags = new Set(config.ignoreTags);
    if (Array.isArray(config.forceIndexOneFor)) config.forceIndexOneFor = new Set(config.forceIndexOneFor);
    if (Array.isArray(config.exceptionsToIndexOneForcing)) config.exceptionsToIndexOneForcing = new Set(config.exceptionsToIndexOneForcing);

    // Ensure smartRelativeIdentifyingChildren uses undefined vs explicit empty array semantics:
    if (configOverride && Object.prototype.hasOwnProperty.call(configOverride, "smartRelativeIdentifyingChildren")) {
      // keep whatever the user provided (could be [])
      // nothing else to do
    } else if (baseConfig.smartRelativeIdentifyingChildren === undefined && config.smartRelativeIdentifyingChildren === undefined) {
      // leave undefined to allow fallback defaults later
    }

    const events = this.tokenizeXML(xml, config);
    if (!events) return null;

    const stackResult = this.buildElementStack(events, offset, config);
    if (!stackResult || !stackResult.stack.length) return null;

    const path = this.processPath(stackResult.stack, config);
    if (!path.length) return null;

    return this.generateXPath(path, config);
  }

  tokenizeXML(xml, config) {
    const cleanedXml = this.preprocessForTokenization(xml);
    const tokenRegex = /<(\/)?([\w:\-\.]+)([^>]*?)(\/?)>|([^<]+)/g;
    const events = [];
    let match;

    try {
      while ((match = tokenRegex.exec(cleanedXml))) {
        if (match[5]) {
          const textContent = match[5].trim();
          if (textContent) {
            events.push({
              type: "text",
              text: textContent,
              pos: match.index,
            });
          }
        } else {
          const event = this.parseXMLToken(match, config);
          if (event) {
            events.push(event);
            if (event.type === "open" && event.selfClose) {
              events.push({ type: "close", tag: event.tag, pos: event.pos });
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

  preprocessForTokenization(xml) {
    let processed = xml;
    processed = processed.replace(/<!--[\s\S]*?-->/g, (match) =>
      " ".repeat(match.length)
    );
    processed = processed.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (match) =>
      " ".repeat(match.length)
    );
    processed = processed.replace(/<\?xml[^>]*\?>/gi, (match) =>
      " ".repeat(match.length)
    );
    processed = processed.replace(/<!DOCTYPE[^>]*>/gi, (match) =>
      " ".repeat(match.length)
    );
    processed = processed.replace(/<\?[^>]*\?>/g, (match) =>
      " ".repeat(match.length)
    );
    return processed;
  }

  parseXMLToken(match, config) {
    const [fullMatch, closeSlash, tag, attrsText, selfCloseSlash] = match;
    const pos = match.index;

    if (closeSlash) {
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
      ...xlinkData,
    };
  }

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

  parseXlinkLabel(attrs, config) {
    const raw = attrs["xlink:label"] || attrs["xlink:lable"];
    if (!raw) return { customIndex: undefined, customIndexRaw: undefined };

    const xlinkPattern = config?.xlinkLabelPattern || { type: "any", pattern: "" };
    let numMatch = null;

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
          const afterPattern = raw.substring(idx + xlinkPattern.pattern.length);
          numMatch = afterPattern.match(/^\d+/);
        }
        break;
      case "endsWith":
        if (raw.endsWith(xlinkPattern.pattern)) {
          const beforeSuffix = raw.substring(0, raw.length - xlinkPattern.pattern.length);
          numMatch = beforeSuffix.match(/\d+$/);
        }
        break;
      case "exactPrefix":
        if (raw.startsWith(xlinkPattern.pattern)) {
          const afterPrefix2 = raw.substring(xlinkPattern.pattern.length);
          numMatch = afterPrefix2.match(/^\d+$/);
        }
        break;
      case "regex":
        try {
          const regex = new RegExp(xlinkPattern.pattern);
          const mat = raw.match(regex);
          if (mat) {
            numMatch = mat[1] ? [mat[1]] : mat[0].match(/\d+/);
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

    const customIndex = numMatch ? parseInt(numMatch[0], 10) : undefined;
    return { customIndex, customIndexRaw: raw };
  }

  buildElementStack(events, offset, config) {
    const currentStack = [];
    let targetStack = [];
    const counters = config.useParentScopedIndices ? {} : [];
    const attributeCounters = {};

    const namespaceMap = (config.includeNamespaces || config.includeDefaultNamespaces)
      ? this.buildNamespaceMap(events)
      : {};

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

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
          indexingAttribute,
          indexingValue,
          preferredAttrs,
          namespaceContext,
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

    // IMPORTANT: only populate identifying children if smart relative requested
    if (config.useSmartRelativePath) {
      targetStack = this.populateIdentifyingChildren(events, targetStack, config);
    }

    if (!targetStack.length && currentStack.length > 0) {
      targetStack = [...currentStack];
    }
    return { stack: targetStack };
  }

  // IMPORTANT CHANGE:
  // If the user explicitly sets smartRelativeIdentifyingChildren = [] we *do not* use fallback defaults.
  // If the setting is undefined (not present), we fall back to a useful default list.
  populateIdentifyingChildren(events, stack, config) {
    let identifyingChildElements = [];

    if (Array.isArray(config.smartRelativeIdentifyingChildren)) {
      // explicit array provided by user
      identifyingChildElements = config.smartRelativeIdentifyingChildren.slice(); // may be empty => intentionally disable detection
    } else {
      // not provided -> fallback defaults
      identifyingChildElements = ['ImageCategoryType', 'id', 'name', 'type', 'category', 'status'];
    }

    // If the user provided an explicit empty array, this will result in no detection (as requested).
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

  findIdentifyingChildren(events, parentEventIndex, parentTag, identifyingTags) {
    const identifyingChildren = [];

    // If identifyingTags is empty, return empty immediately (explicit disable)
    if (!Array.isArray(identifyingTags) || identifyingTags.length === 0) return identifyingChildren;

    let depth = 0;
    let currentChildTag = null;
    let textContent = '';

    for (let i = parentEventIndex + 1; i < events.length; i++) {
      const event = events[i];

      if (event.type === 'open') {
        depth++;
        if (depth === 1) {
          currentChildTag = event.tag;
          textContent = '';
        }
      } else if (event.type === 'close') {
        if (depth === 1 && currentChildTag && identifyingTags.includes(currentChildTag)) {
          identifyingChildren.push({
            name: currentChildTag,
            value: textContent.trim()
          });
        }
        depth--;
        if (depth < 0) break;
        if (depth === 0) {
          currentChildTag = null;
          textContent = '';
        }
      } else if (event.type === 'text') {
        if (depth === 1 && currentChildTag && identifyingTags.includes(currentChildTag)) {
          textContent += event.text || '';
        }
      }
    }

    return identifyingChildren;
  }

  generateXPathSegment(node, index, pathLength, config) {
    const isLeaf = index === pathLength - 1;

    let tagName = node.tag;
    if (config.includeNamespaces || config.includeDefaultNamespaces) {
      tagName = this.addNamespacePrefix(node.tag, node.namespaceContext, config);
    }

    let segment = tagName;

    if (config.useAttributeBasedIndexing && node.preferredAttrs && node.preferredAttrs.length > 0) {
      for (const attr of node.preferredAttrs) {
        const escapedValue = this.escapeAttributeValue(attr.value);
        segment += `[@${attr.name}='${escapedValue}']`;
      }
    } else {
      if (node.preferredAttrs && node.preferredAttrs.length > 0) {
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

  generateXPath(path, config) {
    if (!path || path.length === 0) return "";

    if (config.useSmartRelativePath) {
      return this.generateSmartRelativeXPath(path, config);
    }

    if (config.useRelativePath) {
      return this.generateRelativeXPath(path, config);
    }

    const segments = path.map((node, index) => this.generateXPathSegment(node, index, path.length, config));
    return "/" + segments.join("/");
  }

  escapeAttributeValue(value) {
    return String(value).replace(/'/g, "&apos;");
  }

  generateAttributePredicate(node, config) {
    if (!node.attrName || !node.attrValue || !config.mode.includeAttributes) return "";

    if (config.predicateTemplate) {
      const escapedValue = this.escapeAttributeValue(node.attrValue);
      let predicate = config.predicateTemplate;
      const self = this;
      predicate = predicate.replace(/{at}/g, "@");
      predicate = predicate.replace(/{tag}/g, node.tag);
      predicate = predicate.replace(/{attr1}/g, node.attrName);
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
      predicate = predicate.replace(/ {isFirst}/g, node.idx === 1 ? "true()" : "false()");
      predicate = predicate.replace(/{isLast}/g, `position()=last()`);

      if (node.customIndex !== undefined) {
        predicate = predicate.replace(/{xllv}/g, node.customIndexRaw || "");
        predicate = predicate.replace(/{xllvI}/g, node.customIndex);
      }

      predicate = predicate.replace(/{attr1Lower}/g, (node.attrName || "").toLowerCase());
      predicate = predicate.replace(/{attr1Upper}/g, (node.attrName || "").toUpperCase());
      predicate = predicate.replace(/{attr1VLower}/g, escapedValue.toLowerCase());
      predicate = predicate.replace(/{attr1VUpper}/g, escapedValue.toUpperCase());

      predicate = predicate.replace(/{if:([^:]+):([^:]+):([^}]+)}/g, (match, condition, ifTrue, ifFalse) => {
        if (condition === "hasId") return node.attrs?.id ? ifTrue : ifFalse;
        if (condition === "hasClass") return node.attrs?.class ? ifTrue : ifFalse;
        if (condition === "isFirst") return node.idx === 1 ? ifTrue : ifFalse;
        return ifFalse;
      });

      return predicate;
    }

    const escapedValue = this.escapeAttributeValue(node.attrValue);
    return `[@${node.attrName}='${escapedValue}']`;
  }

  generateIndex(node, isLeaf, config) {
    if (!config.mode.includeIndices || (isLeaf && config.disableLeafIndex)) return "";

    const index = (config.useXlinkLabelIndex && node.customIndex != null) ? node.customIndex : node.idx;

    if (index === 1 &&
      config.exceptionsToIndexOneForcing &&
      config.exceptionsToIndexOneForcing.has && config.exceptionsToIndexOneForcing.has(node.tag)) {
      return "";
    }

    if (index === 1) {
      if (config.skipSingleIndex) {
        if (config.forceIndexOneFor && config.forceIndexOneFor.has && config.forceIndexOneFor.has(node.tag)) return "[1]";
        if (config.ignoreTags && config.ignoreTags.has && config.ignoreTags.has(node.tag)) return "";
        return "";
      } else {
        if (!config.forceIndexOneFor || (config.forceIndexOneFor && config.forceIndexOneFor.size === 0)) {
          return "[1]";
        }
        if (config.forceIndexOneFor && config.forceIndexOneFor.has && config.forceIndexOneFor.has(node.tag)) return "[1]";
        if (config.ignoreTags && config.ignoreTags.has && config.ignoreTags.has(node.tag)) return "";
        return "";
      }
    }

    return `[${index}]`;
  }

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

  buildNamespaceMap(events) {
    const namespaceMap = {};
    const stack = [];

    for (const event of events) {
      if (event.type === "open") {
        const currentContext = stack.length > 0 ? { ...stack[stack.length - 1].namespaces } : {};
        if (event.namespaces) Object.assign(currentContext, event.namespaces);
        stack.push({ tag: event.tag, namespaces: currentContext });
        namespaceMap[`${event.pos}-${event.tag}`] = currentContext;
      } else if (event.type === "close") {
        if (stack.length > 0 && stack[stack.length - 1].tag === event.tag) stack.pop();
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
    const namespace = namespaceContext && namespaceContext[prefix];
    return { prefix, localName, namespace };
  }

  addNamespacePrefix(tagName, namespaceContext, config) {
    if (!config.includeNamespaces) return tagName;

    const nsInfo = this.resolveNamespacePrefix(tagName, namespaceContext || {});
    if (nsInfo.prefix) return tagName;

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

  // --- Relative XPath generator (enhanced) ---
  generateRelativeXPath(path, config) {
    if (!path || path.length === 0) return "";
    const prefix = (config.includeNamespaces) ? (config.relativeNamespacePrefix || config.smartRelativeNamespacePrefix || "d") : null;

    // Build absolute-effect path first (already provided as `path`).
    let effectivePath = path.slice();

    // if relativeDontIgnoreAfter provided: find anchor and start from it
    let startIndex = 0;
    if (config.relativeDontIgnoreAfter) {
      const anchorTag = config.relativeDontIgnoreAfter;
      const anchorIndex = effectivePath.findIndex(el => el.tag === anchorTag);
      if (anchorIndex >= 0) {
        startIndex = anchorIndex;
      } else {
        startIndex = 0;
      }
    }

    const mustInclude = Array.isArray(config.relativeMustIncludeTags) ? config.relativeMustIncludeTags.slice() : [];
    const mustIgnore = Array.isArray(config.relativeMustIgnoreTags) ? config.relativeMustIgnoreTags.slice() : [];
    const sigAttrs = Array.isArray(config.smartRelativeSignificantAttributes) ? config.smartRelativeSignificantAttributes : [];

    const landmarks = [];

    // Always include the first relevant root element (startIndex)
    if (effectivePath[startIndex]) {
      landmarks.push({
        element: effectivePath[startIndex],
        isRoot: true,
        isTarget: (startIndex === effectivePath.length - 1)
      });
    }

    for (let i = startIndex; i < effectivePath.length; i++) {
      const element = effectivePath[i];

      // Explicit ignore list takes precedence
      if (mustIgnore.includes(element.tag)) continue;

      // If tag is in mustInclude, always add
      if (mustInclude.includes(element.tag)) {
        landmarks.push({
          element,
          isRoot: false,
          isTarget: i === effectivePath.length - 1
        });
        continue;
      }

      // If it has a significant attribute -> include
      let hasSigAttr = false;
      if (element.attrs && sigAttrs && sigAttrs.length) {
        for (const a of sigAttrs) {
          if (element.attrs[a]) {
            hasSigAttr = true;
            break;
          }
        }
      }
      if (hasSigAttr) {
        landmarks.push({
          element,
          isRoot: false,
          isTarget: i === effectivePath.length - 1
        });
        continue;
      }

      // If attribute-based indexing is in effect and this element has the attribute -> include
      if (config.useAttributeBasedIndexing && config.attributeBasedIndexingAttribute) {
        const abAttr = config.attributeBasedIndexingAttribute;
        if (element.attrs && element.attrs[abAttr]) {
          landmarks.push({
            element,
            isRoot: false,
            isTarget: i === effectivePath.length - 1
          });
          continue;
        }
      }

      // Otherwise: only include the final (target) element
      if (i === effectivePath.length - 1) {
        landmarks.push({
          element,
          isRoot: false,
          isTarget: true
        });
      }
    }

    // If no landmarks (unlikely), fallback to classic //with all segments
    if (!landmarks.length) {
      const allSegments = effectivePath.map((node, idx) => {
        const name = prefix ? `${prefix}:${node.tag}` : node.tag;
        const pseudo = { ...node };
        const identifier = this.getElementIdentifier(pseudo, config, prefix);
        let seg = name;
        if (identifier) seg += identifier;
        else seg += this.generateIndex(pseudo, idx === effectivePath.length - 1, config);
        return seg;
      });
      return "//" + allSegments.join("/");
    }

    // Build final xpath string from landmarks
    const segments = landmarks.map((lm, idx) => {
      const element = lm.element;
      const name = prefix ? `${prefix}:${element.tag}` : element.tag;
      const identifier = this.getElementIdentifier(element, config, prefix);
      let seg = name;
      if (identifier) seg += identifier;
      else if (lm.isTarget) seg += this.generateIndex(element, true, config);
      return seg;
    });

    return "//" + segments.join("//");
  }

  generateSmartRelativeXPath(path, config) {
    if (!path || path.length === 0) return "";

    const prefix = config.smartRelativeNamespacePrefix || "d";

    let effectivePath = path;
    if (config.smartRelativeIgnoreLastElement && path.length > 1) {
      effectivePath = path.slice(0, -1);
    }

    let startIndex = 0;
    let hasVirtualRoot = false;

    if (config.smartRelativeDontIgnoreAfter) {
      const anchorTag = config.smartRelativeDontIgnoreAfter;
      const anchorIndex = effectivePath.findIndex((el) => el.tag === anchorTag);
      if (anchorIndex >= 0) {
        startIndex = anchorIndex;
        hasVirtualRoot = false;
      } else {
        startIndex = 0;
      }
    }

    if (!config.smartRelativeDontIgnoreAfter && config.smartRelativeVirtualRoot) {
      let virtualRootIndex = -1;
      for (let i = 0; i < effectivePath.length; i++) {
        if (effectivePath[i].tag === config.smartRelativeVirtualRoot) {
          virtualRootIndex = i;
          break;
        }
      }

      if (virtualRootIndex >= 0) {
        hasVirtualRoot = true;
        startIndex = virtualRootIndex + 1;
      } else {
        startIndex = 0;
      }
    } else if (!config.smartRelativeDontIgnoreAfter && !config.smartRelativeVirtualRoot) {
      startIndex = 0;
    }

    const landmarks = [];

    if (!config.smartRelativeLandmarkMode) {
      for (let i = startIndex; i < effectivePath.length; i++) {
        landmarks.push({
          element: effectivePath[i],
          isRoot: i === startIndex,
          isVirtualRoot: false,
          isTarget: i === effectivePath.length - 1
        });
      }
    } else {
      if (effectivePath.length > 0) {
        if (hasVirtualRoot && config.smartRelativeVirtualRoot) {
          const vri = effectivePath.findIndex(e => e.tag === config.smartRelativeVirtualRoot);
          if (vri >= 0) {
            landmarks.push({
              element: path[vri],
              isRoot: true,
              isVirtualRoot: true,
              isTarget: false
            });
          } else {
            landmarks.push({
              element: effectivePath[startIndex],
              isRoot: true,
              isVirtualRoot: false,
              isTarget: false
            });
          }
        } else {
          landmarks.push({
            element: effectivePath[startIndex] || path[0],
            isRoot: true,
            isVirtualRoot: false,
            isTarget: false
          });
        }
      }

      for (let i = startIndex; i < effectivePath.length; i++) {
        const element = effectivePath[i];

        const isAlwaysInclude = Array.isArray(config.smartRelativeAlwaysIncludeTags) &&
          config.smartRelativeAlwaysIncludeTags.includes(element.tag);

        if (isAlwaysInclude || this.hasSignificantAttributes(element, config) || this.hasIdentifyingChildren(element, config)) {
          landmarks.push({
            element,
            isRoot: false,
            isVirtualRoot: false,
            isTarget: false
          });
        }
      }

      if (effectivePath.length > 0) {
        const lastIdx = effectivePath.length - 1;
        landmarks.push({
          element: effectivePath[lastIdx],
          isRoot: false,
          isVirtualRoot: false,
          isTarget: true
        });
      }
    }

    if (config.smartRelativeSingleLine) {
      return this.generateSingleLineSmartXPath(landmarks, config, prefix, !!config.smartRelativeVirtualRoot);
    } else {
      return this.generateMultiLineSmartXPath(landmarks, config, prefix, !!config.smartRelativeVirtualRoot);
    }
  }

  generateSingleLineSmartXPath(landmarks, config, prefix, hasVirtualRoot = false) {
    if (!landmarks || landmarks.length === 0) return "";
    const parts = [];

    for (const lm of landmarks) {
      const element = lm.element;
      let name = prefix ? `${prefix}:${element.tag}` : element.tag;
      let seg = name;

      if (config.useAttributeBasedIndexing && config.attributeBasedIndexingAttribute && element.attrs && element.attrs[config.attributeBasedIndexingAttribute]) {
        const attrName = config.attributeBasedIndexingAttribute;
        const attrValue = element.attrs[attrName];
        seg += `[@${attrName}='${this.escapeAttributeValue(attrValue)}']`;
        const index = element.idx || element.index;
        if (index > 1 || (index === 1 && !config.skipSingleIndex)) {
          seg += `[${index}]`;
        }
      } else {
        const identifier = this.getElementIdentifier(element, config, prefix);
        if (identifier) seg += identifier;
        else if (lm.isTarget) seg += this.generateIndex(element, true, config);
      }

      parts.push(seg);
    }

    if (hasVirtualRoot) {
      return "//" + parts.join("//");
    } else {
      if (parts.length === 1) return "/" + parts[0];
      if (config.useRelativePath) return "//" + parts.join("/");
      return "/" + parts.join("/");
    }
  }

  generateMultiLineSmartXPath(landmarks, config, prefix, hasVirtualRoot = false) {
    if (!landmarks || landmarks.length === 0) return "";

    const indent = " ".repeat(config.smartRelativeIndentSize || 4);
    let result = "";

    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      const element = lm.element;
      let name = prefix ? `${prefix}:${element.tag}` : element.tag;
      let seg = name;

      if (config.useAttributeBasedIndexing && config.attributeBasedIndexingAttribute && element.attrs && element.attrs[config.attributeBasedIndexingAttribute]) {
        const attrName = config.attributeBasedIndexingAttribute;
        const attrValue = element.attrs[attrName];
        seg += `[@${attrName}='${this.escapeAttributeValue(attrValue)}']`;
        const index = element.idx || element.index;
        if (index > 1 || (index === 1 && !config.skipSingleIndex)) {
          seg += `[${index}]`;
        }
      } else {
        const identifier = this.getElementIdentifier(element, config, prefix);
        if (identifier) seg += identifier;
        else if (lm.isTarget) seg += this.generateIndex(element, true, config);
      }

      if (hasVirtualRoot) {
        if (i === 0) result += `//${seg}`;
        else result += `\n${indent}//${seg}`;
      } else {
        if (i === 0) result += `/${seg}`;
        else result += `/${seg}`;
      }
    }

    return result;
  }

  getElementIdentifier(element, config, prefix) {
    const sigAttr = this.findSignificantAttribute(element, config);
    if (sigAttr) {
      const escapedValue = this.escapeAttributeValue(sigAttr.value);
      let identifier = `[@${sigAttr.name}='${escapedValue}']`;
      if (config.useAttributeBasedIndexing && config.attributeBasedIndexingAttribute === sigAttr.name) {
        const index = element.idx || element.index;
        if (index && index > 1) identifier += `[${index}]`;
        else if (index === 1 && !config.skipSingleIndex) identifier += `[1]`;
      }
      return identifier;
    }

    if (element.identifyingChildren && element.identifyingChildren.length > 0) {
      const child = element.identifyingChildren[0];
      const escapedValue = this.escapeAttributeValue(child.value);
      if (prefix) return `[@${prefix}:${child.name}='${escapedValue}']`;
      return `[@${child.name}='${escapedValue}']`;
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
