const vscode = require('vscode');
const { XMLParser } = require('fast-xml-parser');

const CONFIG_SECTION = 'xmlXpath';
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
      if (text.length > 500000) { // 500KB threshold
        console.log('Document too large, using regex fallback');
        return null; // Will trigger regex fallback
      }

      // For moderately large documents, try partial parsing
      if (text.length > 100000) { // 100KB threshold
        return this.parsePartialDocument(document, text);
      }

      // For smaller documents, parse fully
      const structure = this.parseFullDocument(text);
      this.cache.set(uri, { version, structure });
      return structure;
    } catch (error) {
      console.error('XML parsing error:', error);
      return null; // Will trigger regex fallback
    }
  }

  parseFullDocument(xmlText) {
    try {
      // Clean XML before parsing
      const cleanXml = this.preprocessXml(xmlText);
      const parsed = this.parser.parse(cleanXml);
      
      return {
        type: 'full',
        structure: parsed,
        originalText: xmlText
      };
    } catch (error) {
      console.error('Full document parsing failed:', error);
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
        throw new Error('Could not extract valid XML section');
      }
      
      const cleanXml = this.preprocessXml(partialXml.xml);
      const parsed = this.parser.parse(cleanXml);
      
      return {
        type: 'partial',
        startOffset: partialXml.startOffset,
        structure: parsed,
        cursorOffset: offset - partialXml.startOffset,
        originalText: xmlText
      };
    } catch (error) {
      console.error('Partial parsing failed:', error);
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
      if (xmlText[tagStart] === '<' && xmlText[tagStart + 1] !== '/') {
        // Found opening tag, let's use this as start
        break;
      }
      tagStart--;
    }
    
    // Move forward to find matching closing tags
    let pos = tagStart;
    while (pos < xmlText.length && pos < end + 10000) { // Safety limit
      const match = xmlText.substring(pos).match(/<(\/?)([\w:\-\.]+)[^>]*>/);
      if (!match) break;
      
      const isClosing = match[1] === '/';
      const tagName = match[2];
      const fullMatch = match[0];
      
      if (!isClosing && !fullMatch.endsWith('/>')) {
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
      startOffset: tagStart
    };
  }

  preprocessXml(xmlText) {
    // Remove XML declaration if present
    let cleaned = xmlText.replace(/<\?xml[^>]*\?>/i, '');
    
    // Remove comments
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
    
    // Handle CDATA sections (preserve content but escape it)
    cleaned = cleaned.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (match, content) => {
      return this.escapeXml(content);
    });

    // Remove DOCTYPE declarations
    cleaned = cleaned.replace(/<!DOCTYPE[^>]*>/i, '');
    
    return cleaned.trim();
  }

  escapeXml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  buildXPath(document, position) {
    const structure = this.getDocumentStructure(document);
    
    // If parsing failed or document is too large, fall back to regex
    if (!structure) {
      return this.buildXPathRegex(document, position);
    }

    const offset = document.offsetAt(position);
    
    // For now, we'll still use the regex approach as the main XPath builder
    // since converting the fast-xml-parser output to XPath requires more complex logic
    // The parsing serves as validation and can be used for future enhancements
    return this.buildXPathRegex(document, position);
  }

  buildXPathRegex(document, position) {
    const xml = document.getText();
    const offset = document.offsetAt(position);
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const parentTag = cfg.get('parentTag', null);
    const { includeIndices, includeAttributes } = cfg.get('mode', { includeIndices: true, includeAttributes: true });
    const preferred = cfg.get('preferredAttributes', []);
    const ignoreTags = new Set(cfg.get('ignoreIndexTags', []));
    const tpl = includeAttributes ? cfg.get('predicateTemplate', "[@{attr1}='{attr1V}']") : null;
    const disableLeafIndex = cfg.get('disableLeafIndex', false);
    const skipSingleIndex = cfg.get('skipSingleIndex', false);

    // Enhanced tokenization with better error handling
    const tokenRegex = /<(\/)?([\w:\-\.]+)([^>]*?)(\/?)>/g;
    const events = [];
    let m;
    
    try {
      while ((m = tokenRegex.exec(xml))) {
        if (m.index > offset) break;
        
        const isClose = !!m[1];
        const tag = m[2];
        const attrsText = m[3] || '';
        const selfClose = !!m[4];
        const pos = m.index;
        const attrs = {};
        let customIndex, customIndexRaw;

        // Parse attributes more safely
        try {
          attrsText.replace(/([\w:\-\.]+)\s*=\s*(['"])((?:(?!\2)[^\\]|\\.)*)(?:\2)/g, (_, k, quote, v) => {
            if (k === 'xlink:label') { // Fixed typo: was 'xlink:lable'
              customIndexRaw = v;
              const num = v.match(/(\d+)$/);
              if (num) customIndex = Number(num[1]);
            } else if (!k.startsWith('xmlns')) {
              attrs[k] = v;
            }
          });
        } catch (attrError) {
          console.warn('Error parsing attributes:', attrError);
        }

        if (!isClose) {
          events.push({ type: 'open', tag, attrs, pos, customIndex, customIndexRaw });
          if (selfClose) events.push({ type: 'close', tag, pos });
        } else {
          events.push({ type: 'close', tag, pos });
        }
      }
    } catch (regexError) {
      console.error('Regex parsing error:', regexError);
      return null;
    }

    // Build stack and counters
    const stack = [];
    const counters = [];
    
    for (const ev of events) {
      if (ev.pos > offset) break;
      
      if (ev.type === 'open') {
        const depth = stack.length;
        counters[depth] = counters[depth] || {};
        counters[depth][ev.tag] = (counters[depth][ev.tag] || 0) + 1;
        const idx = counters[depth][ev.tag];

        let pickName, pickVal;
        for (const pref of preferred) {
          if (ev.attrs[pref]) {
            pickName = pref;
            pickVal = ev.attrs[pref];
            break;
          }
        }
        
        stack.push({ 
          tag: ev.tag, 
          idx, 
          customIndex: ev.customIndex, 
          customIndexRaw: ev.customIndexRaw, 
          attrName: pickName, 
          attrValue: pickVal 
        });
      } else if (stack.length && stack[stack.length - 1].tag === ev.tag) {
        stack.pop();
      }
    }

    // Apply parentTag slicing
    let path = stack;
    if (parentTag) {
      const i = stack.findIndex(n => n.tag === parentTag);
      if (i >= 0) path = stack.slice(i);
    }
    
    if (!path.length) return null;

    // Build XPath segments
    try {
      return '/' + path.map((n, i) => {
        const isLeaf = i === path.length - 1;
        let s = n.tag;

        // Handle attribute-based predicates
        if (tpl && n.attrName && n.attrValue) {
          const data = {
            tag: n.tag,
            attr1: n.attrName,
            attr1V: n.attrValue,
            xllv: n.customIndexRaw || '',
            xllvI: n.customIndex != null ? n.customIndex : '',
            idx: n.idx
          };
          s += tpl.replace(/\{(\w+)\}/g, (_, key) => data[key] || '');
        } else if (includeAttributes && n.attrName && n.attrValue) {
          // Escape single quotes in attribute values
          const escapedValue = n.attrValue.replace(/'/g, "&apos;");
          s += `[@${n.attrName}='${escapedValue}']`;
        }

        // Handle indices
        if (!(disableLeafIndex && isLeaf) && includeIndices) {
          let ix = n.customIndex != null ? n.customIndex : n.idx;
          
          // Special handling for leaf nodes
          if (isLeaf) ix = 1;

          // Only render the index if it's not a "skip [1]" case
          if (!(skipSingleIndex && ix === 1) && !(ix === 1 && ignoreTags.has(n.tag))) {
            s += `[${ix}]`;
          }
        }

        return s;
      }).join('/');
    } catch (buildError) {
      console.error('XPath building error:', buildError);
      return null;
    }
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
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'xmlXpath.copyXPath';
  context.subscriptions.push(statusBarItem);

  // Register all commands
  registerCommands(context);

  // Optimized update handlers with debouncing
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(debounce(update, 150))
  );
  
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(update)
  );

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
    ['xmlXpath.setParent', setParent],
    ['xmlXpath.setMode', setMode],
    ['xmlXpath.setPreferredAttributes', setPreferredAttrs],
    ['xmlXpath.setIgnoreIndexTags', setIgnoreTags],
    ['xmlXpath.setTemplate', setTemplate],
    ['xmlXpath.copyXPath', copyXPath],
    ['xmlXpath.toggleDisableLeafIndex', toggleDisableLeafIndex],
    ['xmlXpath.toggleSkipSingleIndex', toggleSkipSingleIndex]
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
async function toggleDisableLeafIndex() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get('disableLeafIndex', false);
  await cfg.update('disableLeafIndex', !current, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`disableLeafIndex: ${!current}`);
  update();
}

async function toggleSkipSingleIndex() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get('skipSingleIndex', false);
  await cfg.update('skipSingleIndex', !current, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`skipSingleIndex: ${!current}`);
  update();
}

async function setParent() {
  const value = await vscode.window.showInputBox({ 
    prompt: 'Parent tag for relative XPath (leave empty for full)',
    placeHolder: 'e.g., body, div, etc.'
  });
  if (value !== undefined) {
    await vscode.workspace.getConfiguration(CONFIG_SECTION).update('parentTag', value || null, vscode.ConfigurationTarget.Global);
    update();
  }
}

async function setMode() {
  const options = [
    { label: 'Both', value: { includeIndices: true, includeAttributes: true } },
    { label: 'Attributes Only', value: { includeIndices: false, includeAttributes: true } },
    { label: 'Indices Only', value: { includeIndices: true, includeAttributes: false } },
    { label: 'Simple', value: { includeIndices: false, includeAttributes: false } }
  ];
  const pick = await vscode.window.showQuickPick(options, { placeHolder: 'Select XPath mode' });
  if (pick) {
    await vscode.workspace.getConfiguration(CONFIG_SECTION).update('mode', pick.value, vscode.ConfigurationTarget.Global);
    update();
  }
}

async function setPreferredAttrs() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get('preferredAttributes', []);
  const input = await vscode.window.showInputBox({
    prompt: 'Preferred attributes (comma-separated, e.g. id,name,class)',
    value: current.join(','),
    placeHolder: 'id,name,class,data-id'
  });
  if (input !== undefined) {
    const list = input.split(',').map(s => s.trim()).filter(Boolean);
    await cfg.update('preferredAttributes', list, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Preferred attributes set to: ${list.join(', ')}`);
    update();
  }
}

async function setIgnoreTags() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get('ignoreIndexTags', []);
  const input = await vscode.window.showInputBox({
    prompt: 'Tags to ignore index [1] (comma-separated)',
    value: current.join(','),
    placeHolder: 'div,span,p'
  });
  if (input !== undefined) {
    const list = input.split(',').map(s => s.trim()).filter(Boolean);
    await cfg.update('ignoreIndexTags', list, vscode.ConfigurationTarget.Global);
    update();
  }
}

async function setTemplate() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get('predicateTemplate', "[@{attr1}='{attr1V}']");
  const tpl = await vscode.window.showInputBox({
    prompt: 'Predicate template using tokens {tag},{attr1},{attr1V},{xllv},{xllvI},{idx}',
    value: current,
    placeHolder: "[@{attr1}='{attr1V}']"
  });
  if (tpl !== undefined) {
    await cfg.update('predicateTemplate', tpl, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('Predicate template set.');
    update();
  }
}

async function copyXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  
  try {
    const xpath = xpathBuilder.buildXPath(editor.document, editor.selection.active);
    if (xpath) {
      await vscode.env.clipboard.writeText(xpath);
      vscode.window.showInformationMessage(`Copied XPath: ${xpath}`);
    } else {
      vscode.window.showErrorMessage('Unable to compute XPath for current position.');
    }
  } catch (error) {
    console.error('Error copying XPath:', error);
    vscode.window.showErrorMessage('Error computing XPath. Please check the XML structure.');
  }
}

function update() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return statusBarItem.hide();

  // Only process XML-related files
  const xmlLanguages = ['xml', 'xsl', 'xsd', 'wsdl', 'xaml', 'svg', 'xhtml'];
  if (!xmlLanguages.includes(editor.document.languageId)) {
    return statusBarItem.hide();
  }

  try {
    const xpath = xpathBuilder.buildXPath(editor.document, editor.selection.active);
    if (xpath) {
      // Truncate very long XPaths for display
      const displayXPath = xpath.length > 80 ? xpath.substring(0, 77) + '...' : xpath;
      statusBarItem.text = `$(code) ${displayXPath}`;
      statusBarItem.tooltip = `XPath: ${xpath}\nClick to copy`;
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  } catch (error) {
    console.error('Error updating status bar:', error);
    statusBarItem.hide();
  }
}

module.exports = { activate, deactivate };