const vscode = require('vscode');

// Utility to compute XPath with indices and attributes
function computeXPath(path) {
  return path.map((p, idx) => {
    let part = p.tag;
    // add predicate for attribute
    if (p.attrName && p.attrValue) {
      part += `[@${p.attrName}='${p.attrValue}']`;
    }
    // add index: skip for root
    const index = p.customIndex != null ? p.customIndex : p.index;
    if (idx > 0) {
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
  // choose attribute for predicate: ValuationUseType > name > id > first
  let attrName, attrValue;
  if ('ValuationUseType' in attrs) {
    attrName = 'ValuationUseType'; attrValue = attrs['ValuationUseType'];
  // } else if ('name' in attrs) {
  //   attrName = 'name'; attrValue = attrs['name'];
  // } else if ('id' in attrs) {
  //   attrName = 'id'; attrValue = attrs['id'];
  } else {
    const firstKey = Object.keys(attrs)[0];
    if (firstKey) {
      attrName = firstKey; attrValue = attrs[firstKey];
    }
  }
  return { attrName, attrValue, customIndex };
}

// Build path from cursor to parent
function getXPathFromCursor(document, position, parentTag) {
  const xmlText = document.getText();
  const cursorOffset = document.offsetAt(position);
  const pathStack = [];
  const counts = {};
  const tagRegex = /<(\/?)([\w:\-\.]+)([^>]*)>/g;
  let match;

  while ((match = tagRegex.exec(xmlText))) {
    const isClosing = !!match[1];
    const tag = match[2];
    const attrsString = match[3];
    const start = match.index;
    const end = tagRegex.lastIndex;
    if (!isClosing) {
      const { attrName, attrValue, customIndex } = parseAttributes(attrsString);
      counts[tag] = (counts[tag] || 0) + 1;
      pathStack.push({ tag, index: counts[tag], attrName, attrValue, customIndex });
      if (cursorOffset >= start && cursorOffset <= end) break;
    } else {
      pathStack.pop();
      counts[tag] = Math.max((counts[tag] || 1) - 1, 0);
      if (cursorOffset >= start && cursorOffset <= end) break;
    }
  }

  // determine parent or root
  const effectiveParent = parentTag || pathStack[0]?.tag;
  if (!effectiveParent) return null;
  const idxParent = pathStack.map(p => p.tag).lastIndexOf(effectiveParent);
  if (idxParent < 0) return null;
  const relative = pathStack.slice(idxParent);
  return '/' + computeXPath(relative);
}

function activate(context) {
  const stateKey = 'xmlXpath.parentTag';
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.tooltip = 'XPath from configured parent';
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.setParent', async () => {
      const parentTag = await vscode.window.showInputBox({ prompt: 'Enter parent tag for XPath' });
      if (parentTag) {
        await context.workspaceState.update(stateKey, parentTag);
        statusBarItem.text = `Parent: ${parentTag}`;
        statusBarItem.show();
        vscode.window.showInformationMessage(`Parent tag set to '${parentTag}'`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.clearParent', async () => {
      await context.workspaceState.update(stateKey, undefined);
      statusBarItem.hide();
      vscode.window.showInformationMessage('Parent tag cleared');
    })
  );

  const updateXPath = () => {
    const parentTag = context.workspaceState.get(stateKey);
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const xpath = getXPathFromCursor(editor.document, editor.selection.active, parentTag);
    if (xpath) {
      statusBarItem.text = `XPath: ${xpath}`;
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  };

  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(updateXPath));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateXPath));

  updateXPath();

  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.copyXPath', async () => {
      const parentTag = context.workspaceState.get(stateKey);
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const xpath = getXPathFromCursor(editor.document, editor.selection.active, parentTag);
      if (xpath) {
        await vscode.env.clipboard.writeText(xpath);
        vscode.window.showInformationMessage(`XPath copied: ${xpath}`);
      } else {
        vscode.window.showErrorMessage(`Cannot compute XPath`);
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
