// ========== File: lib/xmlTokenizer.js ==========

/**
 * Replaces comments, CDATA, XML declarations, and DOCTYPE blocks with whitespace
 * to preserve character offsets while removing them from token matches.
 * @param {string} xml Raw XML content.
 * @returns {string} Cleaned XML string.
 */
function preprocessForTokenization(xml) {
  let processed = xml;
  processed = processed.replace(/<!--[\s\S]*?-->/g, (match) => " ".repeat(match.length));
  processed = processed.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (match) => " ".repeat(match.length));
  processed = processed.replace(/<\?xml[^>]*\?>/gi, (match) => " ".repeat(match.length));
  processed = processed.replace(/<!DOCTYPE[^>]*>/gi, (match) => " ".repeat(match.length));
  processed = processed.replace(/<\?[^>]*\?>/g, (match) => " ".repeat(match.length));
  return processed;
}

/**
 * Parses XML attributes from the raw tag body.
 * @param {string} attrsText Attribute string.
 * @returns {object} Parsed attributes map.
 */
function parseAttributes(attrsText) {
  const attrs = {};
  const attrRegex = /([\w:\-\.]+)\s*=\s*(['"])((?:(?!\2)[^\\]|\\.)*?)\2/g;
  let match;
  while ((match = attrRegex.exec(attrsText))) {
    const attrName = match[1];
    const attrValue = match[3];
    attrs[attrName] = attrValue;
  }
  return attrs;
}


/**
 * Extracts xmlns namespace prefixes and URIs from tag attributes text.
 * @param {string} attrsText Attribute string.
 * @returns {object} Map of prefix to namespace URI.
 */
function extractNamespaceInfo(attrsText) {
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

/**
 * Parses a single regex XML token match.
 * @param {Array} match Regex match result.
 * @param {object} config Configuration options.
 * @returns {object|null} Parsed event object.
 */
function parseXMLToken(match, config) {
  const [fullMatch, closeSlash, tag, attrsText, selfCloseSlash] = match;
  const pos = match.index;

  if (closeSlash) {
    return { type: "close", tag, pos: pos + fullMatch.length };
  }

  const attrs = parseAttributes(attrsText || "");
  const namespaces = extractNamespaceInfo(attrsText || "");

  return {
    type: "open",
    tag,
    attrs,
    pos,
    selfClose: !!selfCloseSlash,
    namespaces: Object.keys(namespaces).length > 0 ? namespaces : null,
    length: fullMatch.length,
  };
}

/**
 * Tokenizes XML content into open, close, and text event structures.
 * @param {string} xml XML document content.
 * @param {object} config Configuration options.
 * @returns {Array|null} Array of XML events, or null if tokenization failed.
 */
function tokenizeXML(xml, config) {
  const cleanedXml = preprocessForTokenization(xml);
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
        const event = parseXMLToken(match, config);
        if (event) {
          events.push(event);
          if (event.type === "open" && event.selfClose) {
            events.push({ type: "close", tag: event.tag, pos: event.pos + event.length });
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

/**
 * Builds a prefix mapping index for every opening tag in the events array.
 * @param {Array} events Tokenizer events array.
 * @returns {object} Mapping of "pos-tag" to active namespaces scope.
 */
function buildNamespaceMap(events) {
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

module.exports = {
  preprocessForTokenization,
  parseAttributes,
  extractNamespaceInfo,
  parseXMLToken,
  tokenizeXML,
  buildNamespaceMap,
};
