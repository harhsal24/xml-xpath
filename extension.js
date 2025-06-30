const vscode = require('vscode');

// Utility to compute XPath with configurable options
function computeXPath(path, options = {}) {
  const { includeIndices = true, includeAttributes = true } = options;
  
  return path.map((p, idx) => {
    let part = p.tag;
    
    // Add predicate for attribute (if enabled and available)
    if (includeAttributes && p.attrName && p.attrValue) {
      part += `[@${p.attrName}='${p.attrValue}']`;
    }
    
    // Add index: skip for root, and only if includeIndices is true
    if (includeIndices && idx > 0) {
      const index = p.customIndex != null ? p.customIndex : p.index;
      part += `[${index}]`;
    }
    
    return part;
  }).join('/');
}

// Extract first custom index from xlink:lable, and pick attribute for predicate
function parseAttributes(attrsString) {
  const attrs = {};
  const regex = /([\w:\-]+)\s*=\s*"([^"]*)"/g;
  let match;
  let customIndex;
  
  while ((match = regex.exec(attrsString))) {
    const key = match[1];
    const value = match[2];
    if (key.startsWith('xmlns')) continue;
    if (key === 'xlink:lable') {
      const m = value.match(/(\d+)$/);
      if (m) customIndex = parseInt(m[1], 10);
      continue; // don't include xlink:lable in predicate attrs
    }
    attrs[key] = value;
  }
  
  // Choose attribute for predicate based on priority
  let attrName, attrValue;
  if ('ValuationUseType' in attrs) {
    attrName = 'ValuationUseType'; 
    attrValue = attrs['ValuationUseType'];
  } else if ('name' in attrs) {
    attrName = 'name'; 
    attrValue = attrs['name'];
  } else if ('id' in attrs) {
    attrName = 'id'; 
    attrValue = attrs['id'];
  } else {
    const firstKey = Object.keys(attrs)[0];
    if (firstKey) {
      attrName = firstKey; 
      attrValue = attrs[firstKey];
    }
  }
  
  return { attrName, attrValue, customIndex, allAttrs: attrs };
}

// Build path from cursor to parent with correct sibling indexing
function getXPathFromCursor(document, position, parentTag, options = {}) {
  const xmlText = document.getText();
  const cursorOffset = document.offsetAt(position);
  
  // Parse the entire XML to build a proper tree structure
  const elements = [];
  const tagRegex = /<(\/?)([\w:\-\.]+)([^>]*)>/g;
  let match;
  
  while ((match = tagRegex.exec(xmlText))) {
    const isClosing = !!match[1];
    const tag = match[2];
    const attrsString = match[3];
    const start = match.index;
    const end = tagRegex.lastIndex;
    
    elements.push({
      isClosing,
      tag,
      attrsString,
      start,
      end
    });
  }
  
  // Build the path stack and calculate correct indices
  const pathStack = [];
  const depthCounters = []; // Track sibling counts at each depth level
  
  for (const element of elements) {
    const { isClosing, tag, attrsString, start, end } = element;
    const currentDepth = pathStack.length;
    
    if (!isClosing) {
      // Initialize counter for this depth if not exists
      if (!depthCounters[currentDepth]) {
        depthCounters[currentDepth] = {};
      }
      
      // Count this sibling
      depthCounters[currentDepth][tag] = (depthCounters[currentDepth][tag] || 0) + 1;
      const siblingIndex = depthCounters[currentDepth][tag];
      
      const { attrName, attrValue, customIndex, allAttrs } = parseAttributes(attrsString);
      
      pathStack.push({
        tag,
        index: siblingIndex,
        attrName,
        attrValue,
        customIndex,
        allAttrs
      });
      
      // Check if cursor is within this element's opening tag
      if (cursorOffset >= start && cursorOffset <= end) {
        break;
      }
    } else {
      // Closing tag - pop from stack and reset deeper level counters
      pathStack.pop();
      // Clear counters for deeper levels
      depthCounters.splice(currentDepth);
      
      // Check if cursor is within this closing tag
      if (cursorOffset >= start && cursorOffset <= end) {
        break;
      }
    }
  }

  if (pathStack.length === 0) return null;

  // Determine parent or root
  const effectiveParent = parentTag || pathStack[0]?.tag;
  if (!effectiveParent) return null;
  
  const idxParent = pathStack.map(p => p.tag).lastIndexOf(effectiveParent);
  if (idxParent < 0) return null;
  
  const relative = pathStack.slice(idxParent);
  return '/' + computeXPath(relative, options);
}

// Show XPath generation options dialog
async function showXPathOptions() {
  const options = await vscode.window.showQuickPick([
    {
      label: '$(list-ordered) With Indices & Attributes',
      description: 'Include position indices and attribute predicates',
      detail: 'Example: /root/element[@id="value"][1]/child[2]',
      value: { includeIndices: true, includeAttributes: true }
    },
    {
      label: '$(list-unordered) With Attributes Only',
      description: 'Include attribute predicates but no indices',
      detail: 'Example: /root/element[@id="value"]/child',
      value: { includeIndices: false, includeAttributes: true }
    },
    {
      label: '$(symbol-numeric) With Indices Only',
      description: 'Include position indices but no attribute predicates',
      detail: 'Example: /root/element[1]/child[2]',
      value: { includeIndices: true, includeAttributes: false }
    },
    {
      label: '$(dash) Simple Path',
      description: 'No indices or attributes - simple element path',
      detail: 'Example: /root/element/child',
      value: { includeIndices: false, includeAttributes: false }
    }
  ], {
    placeHolder: 'Select XPath format',
    title: 'XPath Generation Options'
  });

  return options?.value;
}

function activate(context) {
  const stateKey = 'xmlXpath.parentTag';
  const optionsKey = 'xmlXpath.defaultOptions';
  
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.tooltip = 'Click to copy XPath or right-click for options';
  context.subscriptions.push(statusBarItem);

  // Set parent tag command
  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.setParent', async () => {
      const parentTag = await vscode.window.showInputBox({ 
        prompt: 'Enter parent tag name for relative XPath generation',
        placeHolder: 'e.g., root, document, data'
      });
      if (parentTag) {
        await context.workspaceState.update(stateKey, parentTag);
        statusBarItem.text = `Parent: ${parentTag}`;
        statusBarItem.show();
        vscode.window.showInformationMessage(`Parent tag set to '${parentTag}'`);
        updateXPath();
      }
    })
  );

  // Clear parent tag command
  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.clearParent', async () => {
      await context.workspaceState.update(stateKey, undefined);
      updateXPath();
      vscode.window.showInformationMessage('Parent tag cleared');
    })
  );

  // Set default XPath options
  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.setOptions', async () => {
      const options = await showXPathOptions();
      if (options) {
        await context.workspaceState.update(optionsKey, options);
        vscode.window.showInformationMessage('Default XPath options updated');
        updateXPath();
      }
    })
  );

  // Update XPath display
  const updateXPath = () => {
    const parentTag = context.workspaceState.get(stateKey);
    const defaultOptions = context.workspaceState.get(optionsKey, { 
      includeIndices: true, 
      includeAttributes: true 
    });
    
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      statusBarItem.hide();
      return;
    }
    
    const xpath = getXPathFromCursor(editor.document, editor.selection.active, parentTag, defaultOptions);
    if (xpath) {
      const parentText = parentTag ? ` (from ${parentTag})` : '';
      statusBarItem.text = `XPath: ${xpath}${parentText}`;
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  };

  // Event listeners
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(updateXPath));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateXPath));

  // Copy XPath command (with options dialog)
  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.copyXPath', async () => {
      const parentTag = context.workspaceState.get(stateKey);
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const options = await showXPathOptions();
      if (!options) return;

      const xpath = getXPathFromCursor(editor.document, editor.selection.active, parentTag, options);
      if (xpath) {
        await vscode.env.clipboard.writeText(xpath);
        vscode.window.showInformationMessage(`XPath copied: ${xpath}`);
      } else {
        vscode.window.showErrorMessage('Cannot compute XPath at current cursor position');
      }
    })
  );

  // Copy XPath with default options (quick copy)
  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.copyXPathQuick', async () => {
      const parentTag = context.workspaceState.get(stateKey);
      const defaultOptions = context.workspaceState.get(optionsKey, { 
        includeIndices: true, 
        includeAttributes: true 
      });
      
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const xpath = getXPathFromCursor(editor.document, editor.selection.active, parentTag, defaultOptions);
      if (xpath) {
        await vscode.env.clipboard.writeText(xpath);
        vscode.window.showInformationMessage(`XPath copied: ${xpath}`);
      } else {
        vscode.window.showErrorMessage('Cannot compute XPath at current cursor position');
      }
    })
  );

  // Make status bar clickable for quick copy
  statusBarItem.command = 'xmlXpath.copyXPathQuick';

  // Initial update
  updateXPath();
}

function deactivate() {}

module.exports = { activate, deactivate };