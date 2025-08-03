// ========== File: XPathBuilder.js (Final Version) ==========

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
    smartRelativeIgnoreLastElement: false
    };
  }

  buildXPathRegex(document, position) {
    const xml = document.getText();
    const offset = document.offsetAt(position);
    const config = this.loadConfiguration();

    const events = this.tokenizeXML(xml, config); // Pass config
    if (!events) return null;

    const stackResult = this.buildElementStack(events, offset, config);
    if (!stackResult || !stackResult.stack.length) return null;

    const path = this.processPath(stackResult.stack, config);
    if (!path.length) return null;

    return this.generateXPath(path, config);
  }

 // MODIFIED: Enhanced tokenizeXML to capture text content
tokenizeXML(xml, config) {
  const cleanedXml = this.preprocessForTokenization(xml);
  const tokenRegex = /<(\/)?([\w:\-\.]+)([^>]*?)(\/?)>|([^<]+)/g;
  const events = [];
  let match;
  
  try {
    while ((match = tokenRegex.exec(cleanedXml))) {
      if (match[5]) {
        // Text content
        const textContent = match[5].trim();
        if (textContent) {
          events.push({
            type: "text",
            text: textContent,
            pos: match.index
          });
        }
      } else {
        // XML tag
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

    // CORRECTED regex patterns using template literals
    const cdataPattern = `
    <!\
$$
            # Opening <![ (Corrected)
    CDATA           # Literal CDATA
    \\[             # Opening bracket
    [\\s\\S]*?      # Any content including newlines (non-greedy)
    \
$$\\]>         # Closing ]]> (Corrected)
  `;

    // Helper function to clean regex pattern
    const cleanRegexPattern = (pattern) => {
      return pattern
        .split("\n")
        .map((line) => line.replace(/#.*$/, "").trim())
        .join("");
    };

    // Create regex objects
    const cdataRegex = new RegExp(cleanRegexPattern(cdataPattern), "g");

    // Apply replacements
    processed = processed.replace(/<!--[\s\S]*?-->/g, (match) =>
      " ".repeat(match.length)
    );
    processed = processed.replace(cdataRegex, (match) =>
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

  // In the tokenizeXML method, make sure event parsing includes xlink processing
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
    // Enhanced regex to better handle namespaced attributes
    const attrRegex = /([\w:\-\.]+)\s*=\s*(['"])((?:(?!\2)[^\\]|\\.)*?)\2/g;
    let match;

    while ((match = attrRegex.exec(attrsText))) {
      const attrName = match[1];
      const attrValue = match[3];

      // Store all attributes (including xmlns declarations)
      attrs[attrName] = attrValue;

      // Handle common typos
      if (attrName === "xlink:lable") {
        attrs["xlink:label"] = attrValue;
      }
    }

    return attrs;
  }

  parseXlinkLabel(attrs, config) {
    // Check for both correct spelling and common typo
    const raw = attrs["xlink:label"] || attrs["xlink:lable"];
    if (!raw) return { customIndex: undefined, customIndexRaw: undefined };

    const xlinkPattern = config?.xlinkLabelPattern || {
      type: "any",
      pattern: "",
    };
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
          const index = raw.indexOf(xlinkPattern.pattern);
          const afterPattern = raw.substring(
            index + xlinkPattern.pattern.length
          );
          numMatch = afterPattern.match(/^\d+/);
        }
        break;

      case "endsWith":
        if (raw.endsWith(xlinkPattern.pattern)) {
          const beforeSuffix = raw.substring(
            0,
            raw.length - xlinkPattern.pattern.length
          );
          numMatch = beforeSuffix.match(/\d+$/);
        }
        break;

      case "exactPrefix":
        if (raw.startsWith(xlinkPattern.pattern)) {
          const afterPrefix = raw.substring(xlinkPattern.pattern.length);
          numMatch = afterPrefix.match(/^\d+$/); // Must be only numbers after prefix
        }
        break;

      case "regex":
        try {
          const regex = new RegExp(xlinkPattern.pattern);
          const match = raw.match(regex);
          if (match) {
            // Use first capturing group if exists, otherwise whole match
            numMatch = match[1] ? [match[1]] : match[0].match(/\d+/);
          }
        } catch (e) {
          console.error("Invalid xlink regex pattern:", e);
          numMatch = raw.match(/\d+/); // Fallback to any number
        }
        break;

      case "any":
      default:
        // Extract the first number found in the string (current behavior)
        numMatch = raw.match(/\d+/);
        break;
    }

    const customIndex = numMatch ? parseInt(numMatch[0], 10) : undefined;

    // Debug logging
    if (customIndex !== undefined) {
      console.log(
        `Found xlink:label index: ${customIndex} from "${raw}" using ${xlinkPattern.type} pattern`
      );
    }

    return { customIndex, customIndexRaw: raw };
  }

// MODIFIED: Enhanced buildElementStack to capture child elements
buildElementStack(events, offset, config) {
  const currentStack = [];
  let targetStack = [];
  const counters = config.useParentScopedIndices ? {} : [];
  const attributeCounters = {};
  
  const namespaceMap = (config.includeNamespaces || config.includeDefaultNamespaces) ? 
    this.buildNamespaceMap(events) : {};

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    
    if (event.pos > offset && !targetStack.length) {
      targetStack = [...currentStack];
    }

    if (event.type === "open") {
      let idx;
      
      // Existing indexing logic...
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
        // NEW: Track for child element identification
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
  
  // NEW: Populate identifying children for each element
  if (config.useSmartRelativePath) {
    targetStack = this.populateIdentifyingChildren(events, targetStack, config);
  }
  
  if (!targetStack.length && currentStack.length > 0) {
    targetStack = [...currentStack];
  }
  return { stack: targetStack };
}

// NEW: Populate identifying children for smart relative path
populateIdentifyingChildren(events, stack, config) {
  const identifyingChildElements = config.smartRelativeIdentifyingChildren || 
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

// NEW: Find identifying child elements and their text content
findIdentifyingChildren(events, parentEventIndex, parentTag, identifyingTags) {
  const identifyingChildren = [];
  let depth = 0;
  let currentChildTag = null;
  let textContent = '';
  
  // Start from the parent element
  for (let i = parentEventIndex + 1; i < events.length; i++) {
    const event = events[i];
    
    if (event.type === 'open') {
      if (depth === 0) {
        // Direct child of parent
        currentChildTag = event.tag;
        textContent = '';
        
        // Check if this is an identifying child
        if (identifyingTags.includes(event.tag)) {
          // We found an identifying child, now collect its text
        }
      }
      depth++;
      
    } else if (event.type === 'close') {
      depth--;
      
      if (depth === 0 && currentChildTag && identifyingTags.includes(currentChildTag)) {
        // End of identifying child element
        identifyingChildren.push({
          name: currentChildTag,
          value: textContent.trim()
        });
        currentChildTag = null;
        textContent = '';
      }
      
      if (depth < 0) {
        // We've exited the parent element
        break;
      }
      
    } else if (event.type === 'text' && depth === 1 && 
               currentChildTag && identifyingTags.includes(currentChildTag)) {
      // Text content of identifying child
      textContent += event.text || '';
    }
  }
  
  return identifyingChildren;
}
  generateXPathSegment(node, index, pathLength, config) {
    const isLeaf = index === pathLength - 1;

    // NEW: Apply namespace prefix if enabled
    let tagName = node.tag;
    if (config.includeNamespaces || config.includeDefaultNamespaces) {
      tagName = this.addNamespacePrefix(
        node.tag,
        node.namespaceContext,
        config
      );
    }

    let segment = tagName;

    // For attribute-based indexing, include ALL preferred attributes
    if (
      config.useAttributeBasedIndexing &&
      node.preferredAttrs &&
      node.preferredAttrs.length > 0
    ) {
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
      if (attrs[preferred])
        return { attrName: preferred, attrValue: attrs[preferred] };
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

    // NEW: Use relative path if enabled
    if (config.useRelativePath) {
      return this.generateRelativeXPath(path, config);
    }

    // Original absolute path logic
    const segments = path.map((node, index) =>
      this.generateXPathSegment(node, index, path.length, config)
    );
    return "/" + segments.join("/");
  }

  escapeAttributeValue(value) {
    return String(value).replace(/'/g, "&apos;");
  }

  generateAttributePredicate(node, config) {
    if (!node.attrName || !node.attrValue || !config.mode.includeAttributes)
      return "";

    // Use template if provided

    if (config.predicateTemplate) {
      const escapedValue = this.escapeAttributeValue(node.attrValue);

      // Replace template tokens
      let predicate = config.predicateTemplate;

      // Store reference to 'this' for use in callbacks
      const self = this;

      // Basic tokens
      predicate = predicate.replace(/{at}/g, "@");
      predicate = predicate.replace(/{tag}/g, node.tag);
      predicate = predicate.replace(/{attr1}/g, node.attrName);
      predicate = predicate.replace(/{attr1V}/g, escapedValue);
      predicate = predicate.replace(/{idx}/g, node.idx);

      // Advanced tokens for all attributes
      if (node.attrs) {
        // Replace {attr:name} with specific attribute values
        predicate = predicate.replace(/{attr:(\w+)}/g, (match, attrName) => {
          return node.attrs[attrName]
            ? self.escapeAttributeValue(node.attrs[attrName])
            : "";
        });

        // {attrs} - all attributes as conditions
        if (predicate.includes("{attrs}")) {
          const allAttrs = Object.entries(node.attrs)
            .map(([k, v]) => `@${k}='${self.escapeAttributeValue(v)}'`)
            .join(" and ");
          predicate = predicate.replace(/{attrs}/g, allAttrs);
        }

        // {attrCount} - number of attributes
        predicate = predicate.replace(
          /{attrCount}/g,
          Object.keys(node.attrs).length
        );
      }

      // Position tokens
      predicate = predicate.replace(/{pos}/g, node.idx);
      predicate = predicate.replace(/{lastPos}/g, `last()`);
      predicate = predicate.replace(
        /{isFirst}/g,
        node.idx === 1 ? "true()" : "false()"
      );
      predicate = predicate.replace(/{isLast}/g, `position()=last()`);

      // xlink tokens
      if (node.customIndex !== undefined) {
        predicate = predicate.replace(/{xllv}/g, node.customIndexRaw || "");
        predicate = predicate.replace(/{xllvI}/g, node.customIndex);
      }

      // String manipulation tokens
      predicate = predicate.replace(
        /{attr1Lower}/g,
        node.attrName.toLowerCase()
      );
      predicate = predicate.replace(
        /{attr1Upper}/g,
        node.attrName.toUpperCase()
      );
      predicate = predicate.replace(
        /{attr1VLower}/g,
        escapedValue.toLowerCase()
      );
      predicate = predicate.replace(
        /{attr1VUpper}/g,
        escapedValue.toUpperCase()
      );

      // Conditional tokens
      predicate = predicate.replace(
        /{if:([^:]+):([^:]+):([^}]+)}/g,
        (match, condition, ifTrue, ifFalse) => {
          // Simple condition evaluation
          if (condition === "hasId") return node.attrs?.id ? ifTrue : ifFalse;
          if (condition === "hasClass")
            return node.attrs?.class ? ifTrue : ifFalse;
          if (condition === "isFirst") return node.idx === 1 ? ifTrue : ifFalse;
          return ifFalse;
        }
      );

      return predicate;
    }

    // Default format if no template
    const escapedValue = this.escapeAttributeValue(node.attrValue);
    return `[@${node.attrName}='${escapedValue}']`;
  }

  generateIndex(node, isLeaf, config) {
    if (!config.mode.includeIndices || (isLeaf && config.disableLeafIndex))
      return "";

    const index =
      config.useXlinkLabelIndex && node.customIndex != null
        ? node.customIndex
        : node.idx;

    // Debug logging
    if (index === 1) {
      console.log(`Processing ${node.tag}[1]:`);
      console.log(`  - skipSingleIndex: ${config.skipSingleIndex}`);
      console.log(
        `  - forceIndexOneFor size: ${config.forceIndexOneFor?.size || 0}`
      );
      console.log(
        `  - exceptionsToIndexOneForcing has ${
          node.tag
        }: ${config.exceptionsToIndexOneForcing?.has(node.tag)}`
      );
    }

    // FIRST: Check exceptions - these ALWAYS override everything else
    // If tag is in exceptions AND index is 1, never show [1]
    if (
      index === 1 &&
      config.exceptionsToIndexOneForcing &&
      config.exceptionsToIndexOneForcing.has(node.tag)
    ) {
      console.log(`  -> Hiding [1] for ${node.tag} (in exceptions)`);
      return "";
    }

    // For index [1] handling
    if (index === 1) {
      // If skipSingleIndex is ON (true), hide [1] by default
      if (config.skipSingleIndex) {
        // But check if this tag is forced to show [1]
        if (config.forceIndexOneFor && config.forceIndexOneFor.has(node.tag)) {
          return "[1]";
        }
        // Also check ignoreTags
        if (config.ignoreTags && config.ignoreTags.has(node.tag)) {
          return "";
        }
        return ""; // Skip [1] by default when skipSingleIndex is ON
      } else {
        // skipSingleIndex is OFF (false)

        // If forceIndexOneFor is empty, show [1] for all (except exceptions already handled)
        if (!config.forceIndexOneFor || config.forceIndexOneFor.size === 0) {
          console.log(
            `  -> Showing [1] for ${node.tag} (skipSingleIndex OFF, no force list)`
          );
          return "[1]";
        }

        // If forceIndexOneFor has specific tags, only show [1] for those
        if (config.forceIndexOneFor.has(node.tag)) {
          return "[1]";
        }

        // Check ignoreTags
        if (config.ignoreTags && config.ignoreTags.has(node.tag)) {
          return "";
        }

        return ""; // Don't show [1] for non-forced tags when forceIndexOneFor is not empty
      }
    }

    // For all other indices (not 1), always show
    return `[${index}]`;
  }
  // Extract namespace declarations from attributes
  extractNamespaceInfo(attrsText) {
    const namespaces = {};
    const xmlnsRegex =
      /xmlns(?::([^=\s]+))?\s*=\s*(['"])((?:(?!\2)[^\\]|\\.)*?)\2/g;
    let match;

    while ((match = xmlnsRegex.exec(attrsText))) {
      const prefix = match[1] || "default"; // null prefix means default namespace
      const uri = match[3];
      namespaces[prefix] = uri;
    }

    return namespaces;
  }

  // Build namespace map from all events in document
  buildNamespaceMap(events) {
    const namespaceMap = {};
    const stack = [];

    for (const event of events) {
      if (event.type === "open") {
        // Inherit parent namespaces
        const currentContext =
          stack.length > 0 ? { ...stack[stack.length - 1].namespaces } : {};

        // Add any new namespace declarations from this element
        if (event.namespaces) {
          Object.assign(currentContext, event.namespaces);
        }

        stack.push({
          tag: event.tag,
          namespaces: currentContext,
        });

        // Store namespace context for this tag
        namespaceMap[`${event.pos}-${event.tag}`] = currentContext;
      } else if (event.type === "close") {
        if (stack.length > 0 && stack[stack.length - 1].tag === event.tag) {
          stack.pop();
        }
      }
    }

    return namespaceMap;
  }

  // Resolve namespace prefix for a tag name
  resolveNamespacePrefix(tagName, namespaceContext) {
    if (!tagName.includes(":")) {
      return {
        prefix: null,
        localName: tagName,
        namespace: namespaceContext.default,
      };
    }

    const colonIndex = tagName.indexOf(":");
    const prefix = tagName.substring(0, colonIndex);
    const localName = tagName.substring(colonIndex + 1);
    const namespace = namespaceContext[prefix];

    return { prefix, localName, namespace };
  }

  // Add namespace prefix to tag name based on config
  addNamespacePrefix(tagName, namespaceContext, config) {
    if (!config.includeNamespaces) {
      return tagName;
    }

    const nsInfo = this.resolveNamespacePrefix(tagName, namespaceContext || {});

    // If tag already has prefix, keep it
    if (nsInfo.prefix) {
      return tagName;
    }

    // For default namespace handling
    if (config.includeDefaultNamespaces && nsInfo.namespace) {
      // Find prefix for this namespace URI
      for (const [prefix, uri] of Object.entries(namespaceContext || {})) {
        if (uri === nsInfo.namespace && prefix !== "default") {
          return `${prefix}:${nsInfo.localName}`;
        }
      }

      // If default namespace and no prefix found, might need special handling
      if (nsInfo.namespace && namespaceContext?.default === nsInfo.namespace) {
        return `*[local-name()='${nsInfo.localName}']`;
      }
    }

    return tagName;
  }

 // Generate relative XPath using // syntax
generateRelativeXPath(path, config) {
  if (!path || path.length === 0) return "";

  const segments = path.map((node, index) =>
    this.generateXPathSegment(node, index, path.length, config)
  );

  // Use // for relative path
  return "//" + segments.join("/");
}

  // NEW: Find the most significant ancestor element
findSignificantAncestor(stack, config) {
  if (!config.smartRelativeSignificantAttributes || config.smartRelativeSignificantAttributes.length === 0) {
    return -1; // No significant attributes defined
  }
  
  // Look for elements with significant attributes, starting from the end (closest to target)
  for (let i = stack.length - 1; i >= 0; i--) {
    const element = stack[i];
    
    if (element.attrs) {
      // Check if this element has any significant attributes
      for (const sigAttr of config.smartRelativeSignificantAttributes) {
        if (element.attrs[sigAttr]) {
          return i; // Return index of significant ancestor
        }
      }
    }
  }
  
  return -1; // No significant ancestor found
}



// FIXED: Enhanced generateXPath with proper absolute/relative path logic
generateXPath(path, config) {
  if (!path || path.length === 0) return "";
  
  // 1. Check for smart relative path first
  if (config.useSmartRelativePath) {
    return this.generateSmartRelativeXPath(path, config);
  }
  
  // 2. Check for regular relative path
  if (config.useRelativePath) {
    return this.generateRelativeXPath(path, config);
  }
  
  // 3. DEFAULT: Generate absolute path (starts with /)
  const segments = path.map((node, index) =>
    this.generateXPathSegment(node, index, path.length, config)
  );
  
  return "/" + segments.join("/");  // Absolute path with single /
}

// COMPLETELY FIXED: Enhanced smart relative XPath generation with proper virtual root support
// COMPLETELY FIXED: Enhanced smart relative XPath generation with proper virtual root support
generateSmartRelativeXPath(path, config) {
  if (!path || path.length === 0) return "";
  
  const prefix = config.smartRelativeNamespacePrefix || "d";
  const landmarks = [];
  
  // Determine the effective path (exclude last element if configured)
  let effectivePath = path;
  if (config.smartRelativeIgnoreLastElement && path.length > 1) {
    effectivePath = path.slice(0, -1);
  }
  

  
  let startIndex = 0;
  let hasVirtualRoot = false;
  
  // Handle virtual root
  if (config.smartRelativeVirtualRoot) {
    // Find the virtual root in the path
    let virtualRootIndex = -1;
    for (let i = 0; i < effectivePath.length; i++) {
      if (effectivePath[i].tag === config.smartRelativeVirtualRoot) {
        virtualRootIndex = i;
        break;
      }
    }
    
    console.log("Virtual root index:", virtualRootIndex);
    
    if (virtualRootIndex >= 0) {
      hasVirtualRoot = true;
      
      if (config.smartRelativeVirtualRootMode === "include") {
        // Include virtual root as starting point - ONLY process from virtual root onwards
        startIndex = virtualRootIndex;
        
        // Add virtual root as first landmark
        landmarks.push({
          element: effectivePath[virtualRootIndex],
          isRoot: true,
          isVirtualRoot: true,
          isTarget: false
        });
        
        // Continue from next element
        startIndex = virtualRootIndex + 1;
      } else {
        // Exclude virtual root, start from its children
        startIndex = virtualRootIndex + 1;
      }
    } else {
      // Virtual root not found in path
      console.warn(`Virtual root '${config.smartRelativeVirtualRoot}' not found in element path`);
      // Fallback to no virtual root behavior
      hasVirtualRoot = false;
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
    // No virtual root - use document root
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
  

  
  // Find landmark elements (from startIndex onwards)
  for (let i = startIndex; i < effectivePath.length - 1; i++) {
    const element = effectivePath[i];
    
    if (this.hasSignificantAttributes(element, config) || 
        this.hasIdentifyingChildren(element, config)) {
      landmarks.push({
        element: element,
        isRoot: false,
        isVirtualRoot: false,
        isTarget: false
      });
    }
  }
  
  // Add the target element (if we have elements from startIndex onwards)
  if (effectivePath.length > startIndex) {
    const targetElement = effectivePath[effectivePath.length - 1];
    landmarks.push({
      element: targetElement,
      isRoot: false,
      isVirtualRoot: false,
      isTarget: true
    });
  } else if (effectivePath.length > 0 && startIndex === effectivePath.length) {
    // Edge case: virtual root is the target element
    if (landmarks.length > 0) {
      landmarks[landmarks.length - 1].isTarget = true;
    }
  }
  
  
  // Generate formatted XPath
  if (config.smartRelativeSingleLine) {
    return this.generateSingleLineSmartXPath(landmarks, config, prefix, hasVirtualRoot);
  } else {  
    return this.generateMultiLineSmartXPath(landmarks, config, prefix, hasVirtualRoot);
  }
}


// REPLACE the generateSingleLineSmartXPath method:
generateSingleLineSmartXPath(landmarks, config, prefix, hasVirtualRoot = false) {
  const segments = [];
  
  for (const landmark of landmarks) {
    const element = landmark.element;
    let segment = prefix ? `${prefix}:${element.tag}` : element.tag;
    
    // Check if we should use attribute-based indexing for this element
    if (config.useAttributeBasedIndexing && 
        element.attrs && 
        config.attributeBasedIndexingAttribute &&
        element.attrs[config.attributeBasedIndexingAttribute]) {
      
      // For attribute-based indexing, include both attribute and index
      const attrName = config.attributeBasedIndexingAttribute;
      const attrValue = element.attrs[attrName];
      const escapedValue = this.escapeAttributeValue(attrValue);
      
      segment += `[@${attrName}='${escapedValue}']`;
      
      // Add the attribute-based index
      const index = element.idx || element.index;
      if (index > 1 || (index === 1 && !config.skipSingleIndex)) {
        segment += `[${index}]`;
      }
    } else {
      // Use regular identifier logic
      const identifier = this.getElementIdentifier(element, config, prefix);
      if (identifier) {
        segment += identifier;
      } else if (landmark.isTarget) {
        segment += this.generateIndex(element, true, config);
      }
    }
    
    segments.push(segment);
  }
  
  // When using virtual root, ALWAYS start with //
  if (hasVirtualRoot) {
    return "//" + segments.join("//");
  } else {
    // For your use case, you probably want regular path joins, not //
    if (segments.length === 1) {
      return "/" + segments[0];
    } else {
      return "/" + segments.join("/");  // Changed from // to /
    }
  }
}

// REPLACE the generateMultiLineSmartXPath method:
generateMultiLineSmartXPath(landmarks, config, prefix, hasVirtualRoot = false) {
  let result = "";
  const indent = "    ";
  
  for (let i = 0; i < landmarks.length; i++) {
    const landmark = landmarks[i];
    const element = landmark.element;
    
    let segment = prefix ? `${prefix}:${element.tag}` : element.tag;
    
    // Check if we should use attribute-based indexing for this element
    if (config.useAttributeBasedIndexing && 
        element.attrs && 
        config.attributeBasedIndexingAttribute &&
        element.attrs[config.attributeBasedIndexingAttribute]) {
      
      // For attribute-based indexing, include both attribute and index
      const attrName = config.attributeBasedIndexingAttribute;
      const attrValue = element.attrs[attrName];
      const escapedValue = this.escapeAttributeValue(attrValue);
      
      segment += `[@${attrName}='${escapedValue}']`;
      
      // Add the attribute-based index
      const index = element.idx || element.index;
      if (index > 1 || (index === 1 && !config.skipSingleIndex)) {
        segment += `[${index}]`;
      }
    } else {
      // Use regular identifier logic
      const identifier = this.getElementIdentifier(element, config, prefix);
      if (identifier) {
        segment += identifier;
      } else if (landmark.isTarget) {
        segment += this.generateIndex(element, true, config);
      }
    }
    
    // Format the path segments
    if (hasVirtualRoot) {
      if (i === 0) {
        result += `//${segment}`;
      } else {
        result += `\n${indent}//${segment}`;
      }
    } else {
      // Use regular path formatting for non-virtual root
      if (i === 0) {
        result += `/${segment}`;
      } else {
        result += `/${segment}`;  // Direct path, not //
      }
    }
  }
  
  return result;
}

// REPLACE the current getElementIdentifier method with this:
getElementIdentifier(element, config, prefix) {
  // First try actual attributes
  const sigAttr = this.findSignificantAttribute(element, config);
  if (sigAttr) {
    const escapedValue = this.escapeAttributeValue(sigAttr.value);
    let identifier = `[@${sigAttr.name}='${escapedValue}']`;
    
    // ADD: Include attribute-based index if enabled
    if (config.useAttributeBasedIndexing && 
        config.attributeBasedIndexingAttribute === sigAttr.name) {
      
      // Use the attribute-based index that was calculated during stack building
      const index = element.idx || element.index;
      if (index && index > 1) {
        identifier += `[${index}]`;
      } else if (index === 1 && !config.skipSingleIndex) {
        identifier += `[1]`;
      }
    }
    
    return identifier;
  }
  
  // Then try identifying children (as pseudo-attributes)
  if (element.identifyingChildren && element.identifyingChildren.length > 0) {
    const child = element.identifyingChildren[0];
    const escapedValue = this.escapeAttributeValue(child.value);
    return `[@${prefix}:${child.name}='${escapedValue}']`;
  }
  
  return null;
}

// NEW: Check if element has identifying children
hasIdentifyingChildren(element, config) {
  return element.identifyingChildren && element.identifyingChildren.length > 0;
}


// NEW: Check if element has significant attributes
hasSignificantAttributes(element, config) {
  if (!element.attrs || !config.smartRelativeSignificantAttributes) {
    return false;
  }
  
  for (const sigAttr of config.smartRelativeSignificantAttributes) {
    if (element.attrs[sigAttr]) {
      return true;
    }
  }
  return false;
}

// NEW: Find the most significant attribute for display
findSignificantAttribute(element, config) {
  if (!element.attrs || !config.smartRelativeSignificantAttributes) {
    return null;
  }
  
  // Return first significant attribute found
  for (const sigAttr of config.smartRelativeSignificantAttributes) {
    if (element.attrs[sigAttr]) {
      return {
        name: sigAttr,
        value: element.attrs[sigAttr]
      };
    }
  }
  
  // If no significant attributes, return first preferred attribute
  if (element.preferredAttrs && element.preferredAttrs.length > 0) {
    return element.preferredAttrs[0];
  }
  
  return null;
}
}

module.exports = XPathBuilder;
