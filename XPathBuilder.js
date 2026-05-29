// ========== File: XPathBuilder.js ==========

const { XMLParser } = require("fast-xml-parser");
const configManager = require("./lib/configManager.js");
const xmlTokenizer = require("./lib/xmlTokenizer.js");

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

  // Load default configurations from configManager
  loadConfiguration() {
    return configManager.getDefaultConfiguration();
  }

  // Exposed for backward compatibility & testing
  preprocessForTokenization(xml) {
    return xmlTokenizer.preprocessForTokenization(xml);
  }

  tokenizeXML(xml, config) {
    return xmlTokenizer.tokenizeXML(xml, config);
  }

  parseXMLToken(match, config) {
    return xmlTokenizer.parseXMLToken(match, config);
  }

  parseAttributes(attrsText) {
    return xmlTokenizer.parseAttributes(attrsText);
  }

  parseXlinkLabel(attrs, config) {
    return xmlTokenizer.parseXlinkLabel(attrs, config);
  }

  extractNamespaceInfo(attrsText) {
    return xmlTokenizer.extractNamespaceInfo(attrsText);
  }

  buildNamespaceMap(events) {
    return xmlTokenizer.buildNamespaceMap(events);
  }

  /**
   * Main entry point to build an XPath from a document cursor position.
   * @param {object} document VS Code TextDocument mock or real.
   * @param {object} position VS Code Position.
   * @param {object} configOverride Optional overrides.
   * @returns {string|null} Generated XPath, or null.
   */
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

    const events = this.tokenizeXML(xml, config);
    if (!events) return null;

    const stackResult = this.buildElementStack(events, offset, config);
    if (!stackResult || !stackResult.stack.length) return null;

    const path = this.processPath(stackResult.stack, config);
    if (!path.length) return null;

    return this.generateXPath(path, config);
  }

  /**
   * Tracks opening/closing elements to reconstruct the stack at a given character offset.
   * @param {Array} events Tokenizer events.
   * @param {number} offset Character offset in XML document.
   * @param {object} config Configuration options.
   * @returns {object} Element stack mapping.
   */
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
          const parent = currentStack[currentStack.length - 1];
          const scope = config.useParentScopedIndices ? (parent ? parent.eventIndex : "root") : currentStack.length;
          const attrPart = activeIndexingAttrs.map(a => `${a.name}=${a.value}`).join(";");
          const key = `${scope}-${event.tag}-${attrPart}`;
          if (!attributeCounters[key]) attributeCounters[key] = 0;
          attributeCounters[key]++;
          idx = attributeCounters[key];
        } else if (config.useParentScopedIndices) {
          const parent = currentStack[currentStack.length - 1];
          const parentKey = parent ? parent.eventIndex : "root";
          if (!counters[parentKey]) counters[parentKey] = {};
          counters[parentKey][event.tag] = (counters[parentKey][event.tag] || 0) + 1;
          idx = counters[parentKey][event.tag];
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

        if (config.useAttributeBasedIndexing && activeIndexingAttrs.length > 0) {
          for (const activeAttr of activeIndexingAttrs) {
            if (!preferredAttrs.some(pa => pa.name === activeAttr.name)) {
              preferredAttrs.push(activeAttr);
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
          activeIndexingAttrs,
          preferredAttrs,
          namespaceContext,
          eventIndex: i
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

    if (!targetStack.length && currentStack.length > 0) {
      targetStack = [...currentStack];
    }
    return { stack: targetStack };
  }

  generateXPathSegment(node, index, pathLength, config) {
    const isLeaf = index === pathLength - 1;

    let tagName = node.tag;
    if (config.includeNamespaces || config.includeDefaultNamespaces) {
      tagName = this.addNamespacePrefix(node.tag, node.namespaceContext, config);
    }

    let segment = tagName;

    if (config.mode && config.mode.includeAttributes) {
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
      if (config.ignoreTags && config.ignoreTags.has && config.ignoreTags.has(node.tag)) {
        return "";
      }
      if (config.skipSingleIndex) {
        if (config.forceIndexOneFor && config.forceIndexOneFor.has && config.forceIndexOneFor.has(node.tag)) return "[1]";
        return "";
      } else {
        if (config.forceIndexOneFor && config.forceIndexOneFor.has && config.forceIndexOneFor.has(node.tag)) return "[1]";
        if (config.forceIndexOneFor && config.forceIndexOneFor.size > 0) return "";
        return "[1]";
      }
    }

    return `[${index}]`;
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
    const nsInfo = this.resolveNamespacePrefix(tagName, namespaceContext || {});
    if (nsInfo.prefix) {
      return config.includeNamespaces ? tagName : nsInfo.localName;
    }

    if (config.includeDefaultNamespaces && nsInfo.namespace) {
      for (const [prefix, uri] of Object.entries(namespaceContext || {})) {
        if (uri === nsInfo.namespace && prefix !== "default") {
          return config.includeNamespaces ? `${prefix}:${nsInfo.localName}` : nsInfo.localName;
        }
      }
      if (nsInfo.namespace && namespaceContext?.default === nsInfo.namespace) {
        const defaultPrefix = config.defaultNamespacePrefix || "d";
        return `${defaultPrefix}:${nsInfo.localName}`;
      }
    }
    return tagName;
  }

  generateRelativeXPath(path, config) {
    if (!path || path.length === 0) return "";

    let effectivePath = path.slice();

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

    const landmarks = [];

    if (effectivePath[startIndex]) {
      landmarks.push({
        element: effectivePath[startIndex],
        isRoot: true,
        isTarget: (startIndex === effectivePath.length - 1)
      });
    }

    for (let i = startIndex; i < effectivePath.length; i++) {
      const element = effectivePath[i];

      if (mustIgnore.includes(element.tag)) continue;

      if (mustInclude.includes(element.tag)) {
        landmarks.push({
          element,
          isRoot: false,
          isTarget: i === effectivePath.length - 1
        });
        continue;
      }

      if (config.useAttributeBasedIndexing && config.attributeBasedIndexingAttribute) {
        let hasIndexingAttr = false;
        const abAttrs = typeof config.attributeBasedIndexingAttribute === "string"
          ? [config.attributeBasedIndexingAttribute]
          : (Array.isArray(config.attributeBasedIndexingAttribute) ? config.attributeBasedIndexingAttribute : []);
        for (const abAttr of abAttrs) {
          if (abAttr && element.attrs && element.attrs[abAttr.trim()] !== undefined) {
            hasIndexingAttr = true;
            break;
          }
        }
        if (hasIndexingAttr) {
          landmarks.push({
            element,
            isRoot: false,
            isTarget: i === effectivePath.length - 1
          });
          continue;
        }
      }

      if (i === effectivePath.length - 1) {
        landmarks.push({
          element,
          isRoot: false,
          isTarget: true
        });
      }
    }

    if (!landmarks.length) {
      const allSegments = effectivePath.map((node, idx) => {
        let tagName = node.tag;
        if (config.includeNamespaces || config.includeDefaultNamespaces) {
          tagName = this.addNamespacePrefix(node.tag, node.namespaceContext, config);
        }
        let seg = tagName;

        if (config.mode && config.mode.includeAttributes) {
          if (config.useAttributeBasedIndexing && node.preferredAttrs && node.preferredAttrs.length > 0) {
            for (const attr of node.preferredAttrs) {
              const escapedValue = this.escapeAttributeValue(attr.value);
              seg += `[@${attr.name}='${escapedValue}']`;
            }
          } else {
            if (node.preferredAttrs && node.preferredAttrs.length > 0) {
              const attr = node.preferredAttrs[0];
              const escapedValue = this.escapeAttributeValue(attr.value);
              seg += `[@${attr.name}='${escapedValue}']`;
            }
          }
        }

        seg += this.generateIndex(node, idx === effectivePath.length - 1, config);
        return seg;
      });
      return "//" + allSegments.join("/");
    }

    const segments = landmarks.map((lm, idx) => {
      const element = lm.element;
      let tagName = element.tag;
      if (config.includeNamespaces || config.includeDefaultNamespaces) {
        tagName = this.addNamespacePrefix(element.tag, element.namespaceContext, config);
      }
      let seg = tagName;

      if (config.mode && config.mode.includeAttributes) {
        if (config.useAttributeBasedIndexing && element.preferredAttrs && element.preferredAttrs.length > 0) {
          for (const attr of element.preferredAttrs) {
            const escapedValue = this.escapeAttributeValue(attr.value);
            seg += `[@${attr.name}='${escapedValue}']`;
          }
        } else {
          if (element.preferredAttrs && element.preferredAttrs.length > 0) {
            const attr = element.preferredAttrs[0];
            const escapedValue = this.escapeAttributeValue(attr.value);
            seg += `[@${attr.name}='${escapedValue}']`;
          }
        }
      }

      if (lm.isTarget) {
        seg += this.generateIndex(element, true, config);
      }
      return seg;
    });

    return "//" + segments.join("//");
  }
}

module.exports = XPathBuilder;
