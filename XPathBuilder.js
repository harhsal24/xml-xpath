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

  buildXPathRegex(document, position) {
    const xml = document.getText();
    const offset = document.offsetAt(position);
    const config = this.loadConfiguration();

    const events = this.tokenizeXML(xml);
    if (!events) return null;

    const stackResult = this.buildElementStack(events, offset, config);
    if (!stackResult || !stackResult.stack.length) return null;

    const path = this.processPath(stackResult.stack, config);
    if (!path.length) return null;

    return this.generateXPath(path, config);
  }

  tokenizeXML(xml) {
    const cleanedXml = this.preprocessForTokenization(xml);
    const tokenRegex = /<(\/)?([\w:\-\.]+)([^>]*?)(\/?)>/g;
    const events = [];
    let match;
    try {
      while ((match = tokenRegex.exec(cleanedXml))) {
        const event = this.parseXMLToken(match);
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
    processed = processed.replace(/<!--[\s\S]*?-->/g, (match) => ' '.repeat(match.length));
    processed = processed.replace(/<!\[CDATA$$[\s\S]*?$$\]>/g, (match) => ' '.repeat(match.length));
    processed = processed.replace(/<\?xml[^>]*\?>/gi, (match) => ' '.repeat(match.length));
    processed = processed.replace(/<!DOCTYPE[^>]*>/gi, (match) => ' '.repeat(match.length));
    processed = processed.replace(/<\?[^>]*\?>/g, (match) => ' '.repeat(match.length));
    return processed;
  }

  parseXMLToken(match) {
    const [fullMatch, closeSlash, tag, attrsText, selfCloseSlash] = match;
    const pos = match.index;
    if (closeSlash) {
      return { type: "close", tag, pos: pos + fullMatch.length };
    }
    const attrs = this.parseAttributes(attrsText || "");
    const xlinkData = this.parseXlinkLabel(attrs);
    return { type: "open", tag, attrs, pos, selfClose: !!selfCloseSlash, ...xlinkData };
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
    if (attrName === 'xlink:lable') {
      attrs['xlink:label'] = attrValue; // Fix common typo
    }
  }
  return attrs;
}

parseXlinkLabel(attrs) {
  // Check for both correct spelling and common typo
  const raw = attrs['xlink:label'] || attrs['xlink:lable'];
  if (!raw) return { customIndex: undefined, customIndexRaw: undefined };
  
  // Extract the first number found in the string
  const numMatch = raw.match(/\d+/);
  const customIndex = numMatch ? parseInt(numMatch[0], 10) : undefined;
  
  // Debug logging (remove in production)
  if (customIndex !== undefined) {
    console.log(`Found xlink:label index: ${customIndex} from "${raw}"`);
  }
  
  return { customIndex, customIndexRaw: raw };
}

  buildElementStack(events, offset, config) {
    const currentStack = [];
    let targetStack = [];
    const counters = config.useParentScopedIndices ? {} : [];

    for (const event of events) {
      if (event.pos > offset && !targetStack.length) {
         // The moment we pass the cursor, the previous stack was the correct one.
         targetStack = [...currentStack];
      }

      if (event.type === "open") {
        let idx;
        if (config.useParentScopedIndices) {
          const parentPath = currentStack.map(e => `${e.tag}[${e.idx}]`).join('/');
          if (!counters[parentPath]) counters[parentPath] = {};
          counters[parentPath][event.tag] = (counters[parentPath][event.tag] || 0) + 1;
          idx = counters[parentPath][event.tag];
        } else {
          const depth = currentStack.length;
          if (!counters[depth]) counters[depth] = {};
          counters[depth][event.tag] = (counters[depth][event.tag] || 0) + 1;
          idx = counters[depth][event.tag];
        }
        const { attrName, attrValue } = this.selectPreferredAttribute(event.attrs, config.preferredAttributes);
        currentStack.push({ tag: event.tag, idx, customIndex: event.customIndex, customIndexRaw: event.customIndexRaw, attrName, attrValue,attrs: event.attrs });
      } else if (event.type === "close") {
        if (currentStack.length > 0 && currentStack[currentStack.length - 1].tag === event.tag) {
          // If the cursor is right on the closing tag, the stack *before* popping is the correct one.
          if (event.pos >= offset && !targetStack.length) {
            targetStack = [...currentStack];
          }
          currentStack.pop();
        }
      }
    }
    // If the loop finished and we never set a target (e.g., cursor at end of file), use the final stack.
    if (!targetStack.length && currentStack.length > 0) {
        targetStack = [...currentStack];
    }
    return { stack: targetStack };
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
    if (!path || path.length === 0) return '';
    const segments = path.map((node, index) => this.generateXPathSegment(node, index, path.length, config));
    return "/" + segments.join("/");
  }

  generateXPathSegment(node, index, pathLength, config) {
    const isLeaf = index === pathLength - 1;
    let segment = node.tag;
    segment += this.generateAttributePredicate(node, config);
    segment += this.generateIndex(node, isLeaf, config);
    return segment;
  }

  generateAttributePredicate(node, config) {
    if (!node.attrName || !node.attrValue || !config.mode.includeAttributes) return "";
    const escapedValue = this.escapeAttributeValue(node.attrValue);
    return `[@${node.attrName}='${escapedValue}']`;
  }
  
  generateIndex(node, isLeaf, config) {
    if (!config.mode.includeIndices || (isLeaf && config.disableLeafIndex)) return "";
    const index = config.useXlinkLabelIndex && node.customIndex != null ? node.customIndex : node.idx;
    if ((config.skipSingleIndex && index === 1) || (config.ignoreTags && config.ignoreTags.has(node.tag) && index === 1)) return "";
    return `[${index}]`;
  }
  
  escapeAttributeValue(value) {
    return String(value).replace(/'/g, "&apos;");
  }
}

module.exports = XPathBuilder;