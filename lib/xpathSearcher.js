// ========== File: lib/xpathSearcher.js ==========

const xmlTokenizer = require("./xmlTokenizer.js");

/**
 * Parses an XPath query string into structured segments with tag names and predicates.
 * This parser is intentionally conservative: it supports typical predicates:
 * numeric positions [1], attribute equality [@id='x'], contains(@attr,'x'), text()="x", position(), last()
 * @param {string} xpath XPath query string.
 * @returns {Array} List of segments.
 */
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

/**
 * Evaluates how deep the stack matches the provided XPath segments.
 * @param {Array} stack Current elements stack.
 * @param {Array} xpathSegments Target segments to match.
 * @param {object} config Configuration options.
 * @returns {object} Match result { depth }.
 */
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
        let actualIndex = stackItem.index;

        // If attribute-based indexing is used, stackItem.index already represents that sequence index
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
        // text predicate unsupported in deep mode
        allPredicatesMatch = false;
        break;
      } else {
        allPredicatesMatch = false;
        break;
      }
    }

    if (!allPredicatesMatch) break;

    depth++;
  }

  return { depth };
}

/**
 * Searches for an element matching the given XPath segments in the tokenizer events stream.
 * @param {Array} events Tokenizer events.
 * @param {Array} xpathSegments Parsed XPath segments.
 * @param {string} xml Full XML text document.
 * @param {object} config Configuration options.
 * @returns {object|null} Match details, or null.
 */
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
      const depth = stack.length;
      let idx;

      let activeIndexingAttrs = [];

      if (config.useAttributeBasedIndexing) {
        let indexingAttrs = [];
        if (typeof config.attributeBasedIndexingAttribute === "string") {
          if (config.attributeBasedIndexingAttribute.trim()) {
            indexingAttrs = [config.attributeBasedIndexingAttribute.trim()];
          }
        } else if (Array.isArray(config.attributeBasedIndexingAttribute)) {
          indexingAttrs = config.attributeBasedIndexingAttribute.map(a => typeof a === "string" ? a.trim() : "").filter(Boolean);
        }

        if (indexingAttrs.length > 0) {
          for (const attr of indexingAttrs) {
            if (event.attrs && event.attrs[attr] !== undefined) {
              activeIndexingAttrs.push({ name: attr, value: event.attrs[attr] });
            }
          }
        } else if (config.preferredAttributes && config.preferredAttributes.length > 0) {
          for (const attr of config.preferredAttributes) {
            if (event.attrs && event.attrs[attr] !== undefined) {
              activeIndexingAttrs.push({ name: attr, value: event.attrs[attr] });
              break;
            }
          }
        }
      }

      if (config.useAttributeBasedIndexing && activeIndexingAttrs.length > 0) {
        const parent = stack[stack.length - 1];
        const scope = config.useParentScopedIndices ? (parent ? parent.eventIndex : "root") : stack.length;
        const attrPart = activeIndexingAttrs.map(a => `${a.name}=${a.value}`).join(";");
        const key = `${scope}-${event.tag}-${attrPart}`;
        if (!attributeCounters[key]) attributeCounters[key] = 0;
        attributeCounters[key]++;
        idx = attributeCounters[key];
      } else if (config.useParentScopedIndices) {
        const parent = stack[stack.length - 1];
        const parentKey = parent ? parent.eventIndex : "root";
        if (!counters[parentKey]) counters[parentKey] = {};
        counters[parentKey][event.tag] = (counters[parentKey][event.tag] || 0) + 1;
        idx = counters[parentKey][event.tag];
      } else {
        if (!counters[depth]) counters[depth] = {};
        counters[depth][event.tag] = (counters[depth][event.tag] || 0) + 1;
        idx = counters[depth][event.tag];
      }

      const preferredAttrs = [];
      if (event.attrs && config.preferredAttributes) {
        for (const attrName of config.preferredAttributes) {
          if (event.attrs[attrName]) preferredAttrs.push({ name: attrName, value: event.attrs[attrName] });
        }
      }

      if (config.useAttributeBasedIndexing && activeIndexingAttrs.length > 0) {
        for (const activeAttr of activeIndexingAttrs) {
          if (!preferredAttrs.some(pa => pa.name === activeAttr.name)) {
            preferredAttrs.push(activeAttr);
          }
        }
      }

      stack.push({
        tag: event.tag,
        idx,
        index: idx,
        attrs: event.attrs,
        activeIndexingAttrs,
        preferredAttrs,
        startOffset: event.pos,
        eventIndex: i,
      });

      const matchInfo = getMatchDepth(stack, xpathSegments, config);

      if (matchInfo.depth > maxMatchedDepth) {
        maxMatchedDepth = matchInfo.depth;

        const matchedElementIndex = matchInfo.depth - 1;
        if (matchedElementIndex >= 0 && matchedElementIndex < stack.length) {
          const matchedElement = stack[matchedElementIndex];

          const startEvtIdx = matchedElement.eventIndex;
          const matchedTag = matchedElement.tag;
          let openCount = 1;
          let endOffset = matchedElement.startOffset + matchedTag.length + 2;

          for (let j = startEvtIdx + 1; j < events.length; j++) {
            if (events[j].type === "open" && events[j].tag === matchedTag) openCount++;
            else if (events[j].type === "close" && events[j].tag === matchedTag) {
              openCount--;
              if (openCount === 0) {
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

      if (matchInfo.depth === xpathSegments.length) {
        const lastElement = stack[stack.length - 1];
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
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].tag === event.tag) {
            stack.splice(k, 1);
            break;
          }
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Orchestrates finding an element offset using raw XPath inside a editor window's document.
 * @param {object} editor VS Code TextEditor.
 * @param {string} xpath XPath query string.
 * @param {object} config Configuration options.
 * @returns {Promise<object|null>} Result node object, or null.
 */
async function findElementByXPath(editor, xpath, config) {
  const xml = editor.document.getText();
  const segments = parseXPath(xpath);
  if (!segments || segments.length === 0) throw new Error("Invalid or empty XPath");

  const events = xmlTokenizer.tokenizeXML(xml, config);
  if (!events) throw new Error("Failed to parse XML");

  return searchForElement(events, segments, xml, config);
}

module.exports = {
  parseXPath,
  getMatchDepth,
  searchForElement,
  findElementByXPath,
};
