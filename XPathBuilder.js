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
    useAttributeBasedIndexing: false, // ADD THIS
    attributeBasedIndexingAttribute: "" // ADD THIS
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

  tokenizeXML(xml, config) {
    const cleanedXml = this.preprocessForTokenization(xml);
    const tokenRegex = /<(\/)?([\w:\-\.]+)([^>]*?)(\/?)>/g;
    const events = [];
    let match;
    try {
      while ((match = tokenRegex.exec(cleanedXml))) {
        const event = this.parseXMLToken(match, config); // Pass config
        if (event) {
          events.push(event);
          if (event.type === "open" && event.selfClose) {
            events.push({ type: "close", tag: event.tag, pos: event.pos });
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

  parseXMLToken(match, config) {
    const [fullMatch, closeSlash, tag, attrsText, selfCloseSlash] = match;
    const pos = match.index;
    if (closeSlash) {
      return { type: "close", tag, pos: pos + fullMatch.length };
    }
    const attrs = this.parseAttributes(attrsText || "");
    const xlinkData = this.parseXlinkLabel(attrs, config);
    return {
      type: "open",
      tag,
      attrs,
      pos,
      selfClose: !!selfCloseSlash,
      ...xlinkData,
    };
  }

  parseAttributes(attrsText) {
    const attrs = {};
    // Updated regex to handle namespaced attributes better
    const attrRegex = /([\w:\-\.]+)\s*=\s*(['"])((?:(?!\2)[^\\]|\\.)*?)\2/g;
    let match;
    while ((match = attrRegex.exec(attrsText))) {
      const attrName = match[1];
      const attrValue = match[3];

      // Store all attributes (including xlink:label)
      attrs[attrName] = attrValue;

      // Also check for common typos/variations
      if (attrName === "xlink:lable") {
        attrs["xlink:label"] = attrValue; // Fix common typo
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

buildElementStack(events, offset, config) {
  const currentStack = [];
  let targetStack = [];
  const counters = config.useParentScopedIndices ? {} : [];
  const attributeCounters = {}; // For attribute-based indexing

  for (const event of events) {
    if (event.pos > offset && !targetStack.length) {
      targetStack = [...currentStack];
    }

    if (event.type === "open") {
      let idx;
      
      // Determine which attribute to use for indexing
      let indexingAttribute = null;
      let indexingValue = null;
      
      if (config.useAttributeBasedIndexing) {
        // Use first preferred attribute for indexing
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
      
      // Calculate index based on mode
      if (config.useAttributeBasedIndexing && indexingAttribute && indexingValue) {
        // Attribute-based indexing
        const depth = currentStack.length;
        const key = `${depth}-${event.tag}-${indexingAttribute}-${indexingValue}`;
        
        if (!attributeCounters[key]) {
          attributeCounters[key] = 0;
        }
        attributeCounters[key]++;
        idx = attributeCounters[key];
      } else if (config.useParentScopedIndices) {
        // Parent-scoped indexing (existing code)
        const parentPath = currentStack
          .map((e) => `${e.tag}[${e.idx}]`)
          .join("/");
        if (!counters[parentPath]) counters[parentPath] = {};
        counters[parentPath][event.tag] =
          (counters[parentPath][event.tag] || 0) + 1;
        idx = counters[parentPath][event.tag];
      } else {
        // Depth-based indexing (existing code)
        const depth = currentStack.length;
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
              value: event.attrs[attrName]
            });
          }
        }
      }
      
      currentStack.push({
        tag: event.tag,
        idx,
        customIndex: event.customIndex,
        customIndexRaw: event.customIndexRaw,
        attrs: event.attrs,
        // Store the attribute used for indexing
        indexingAttribute: indexingAttribute,
        indexingValue: indexingValue,
        // Store ALL preferred attributes
        preferredAttrs: preferredAttrs
      });
    } else if (event.type === "close") {
      if (
        currentStack.length > 0 &&
        currentStack[currentStack.length - 1].tag === event.tag
      ) {
        if (event.pos >= offset && !targetStack.length) {
          targetStack = [...currentStack];
        }
        currentStack.pop();
      }
    }
  }
  
  if (!targetStack.length && currentStack.length > 0) {
    targetStack = [...currentStack];
  }
  return { stack: targetStack };
}

generateXPathSegment(node, index, pathLength, config) {
  const isLeaf = index === pathLength - 1;
  let segment = node.tag;
  
  // For attribute-based indexing, include ALL preferred attributes
  if (config.useAttributeBasedIndexing && node.preferredAttrs && node.preferredAttrs.length > 0) {
    // Add all preferred attributes as predicates
    for (const attr of node.preferredAttrs) {
      const escapedValue = this.escapeAttributeValue(attr.value);
      segment += `[@${attr.name}='${escapedValue}']`;
    }
  } else {
    // Normal mode - use the selectPreferredAttribute logic
    if (node.preferredAttrs && node.preferredAttrs.length > 0) {
      // Use first preferred attribute only
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
}

module.exports = XPathBuilder;
