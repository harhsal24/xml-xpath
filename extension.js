const vscode = require('vscode');
const CONFIG_SECTION = 'xmlXpath';
// Activation and deactivation
let statusBarItem;
function activate(context) {
  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'xmlXpath.copyXPath';
  context.subscriptions.push(statusBarItem);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.setParent', setParent)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.setMode', setMode)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.setPreferredAttributes', setPreferredAttrs)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.setIgnoreIndexTags', setIgnoreTags)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.copyXPath', copyXPath)
  );

  // Update on cursor move or editor change
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(update)
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(update)
  );

  update();
}

function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}

// Command implementations
async function setParent() {
  const value = await vscode.window.showInputBox({ prompt: 'Parent tag for relative XPath (leave empty for full)' });
  await vscode.workspace.getConfiguration(CONFIG_SECTION).update('parentTag', value || null, vscode.ConfigurationTarget.Global);
  update();
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
    value: current.join(',')
  });
  if (input === undefined) return;
  const list = input.split(',').map(s => s.trim()).filter(Boolean);
  await cfg.update('preferredAttributes', list, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Preferred attributes set to: ${list.join(', ')}`);
  update();
}

async function setIgnoreTags() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get('ignoreIndexTags', []);
  const input = await vscode.window.showInputBox({
    prompt: 'Tags to ignore index [1] (comma-separated)',
    value: current.join(',')
  });
  if (input !== undefined) {
    const list = input.split(',').map(s => s.trim()).filter(Boolean);
    await cfg.update('ignoreIndexTags', list, vscode.ConfigurationTarget.Global);
    update();
  }
}

async function copyXPath() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const xpath = buildXPath(editor.document, editor.selection.active);
  if (xpath) {
    await vscode.env.clipboard.writeText(xpath);
    vscode.window.showInformationMessage(`Copied XPath: ${xpath}`);
  } else {
    vscode.window.showErrorMessage('Unable to compute XPath.');
  }
}

function update() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return statusBarItem.hide();

  const xpath = buildXPath(editor.document, editor.selection.active);
  if (xpath) {
    statusBarItem.text = `$(code) ${xpath}`;
    statusBarItem.tooltip = 'Click to copy XPath';
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

function buildXPath(document, position) {
  const xml = document.getText();
  const offset = document.offsetAt(position);

  // Load settings from xmlXpath section
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const parentTag = cfg.get('parentTag', null);
  const { includeIndices, includeAttributes } = cfg.get('mode', { includeIndices: true, includeAttributes: true });
  const preferred = cfg.get('preferredAttributes', []);
  const ignoreTags = new Set(cfg.get('ignoreIndexTags', []));

  // Tokenize
  const tokenRegex = /<(\/)?([\w:\-\.]+)([^>]*?)(\/)?>/g;
  const events = [];
  let m;
  while ((m = tokenRegex.exec(xml))) {
    const isClose = !!m[1];
    const tag = m[2];
    const attrsText = m[3] || '';
    const selfClose = !!m[4];
    const pos = m.index;
    const attrs = {};
    let customIndex;
    attrsText.replace(/([\w:\-\.]+)\s*=\s*\"([^\"]*)\"/g, (_, k, v) => {
      if (k === 'xlink:lable') {
        const num = v.match(/(\d+)$/);
        if (num) customIndex = Number(num[1]);
      } else if (!k.startsWith('xmlns')) {
        attrs[k] = v;
      }
    });

    if (!isClose) {
      events.push({ type: 'open', tag, attrs, pos, customIndex });
      if (selfClose) events.push({ type: 'close', tag, pos });
    } else {
      events.push({ type: 'close', tag, pos });
    }
    if (pos > offset) break;
  }

  // Walk to offset
  const stack = [];
  const counters = [];
  for (const ev of events) {
    if (ev.pos > offset) break;
    if (ev.type === 'open') {
      const depth = stack.length;
      counters[depth] = counters[depth] || {};
      counters[depth][ev.tag] = (counters[depth][ev.tag] || 0) + 1;
      const idx = counters[depth][ev.tag];

      // pick attr by preference only
      let pickName, pickVal;
      for (const pref of preferred) {
        if (ev.attrs[pref]) {
          pickName = pref;
          pickVal = ev.attrs[pref];
          break;
        }
      }
      // no fallback: if element doesn’t have one of the preferred attributes, skip attributes

      stack.push({ tag: ev.tag, idx, customIndex: ev.customIndex, attrName: pickName, attrValue: pickVal });
    } else {
      if (stack.length && stack[stack.length-1].tag === ev.tag) stack.pop();
    }
  }

  // apply parentTag
  let path = stack;
  if (parentTag) {
    const i = stack.findIndex(n => n.tag === parentTag);
    if (i >= 0) path = stack.slice(i);
  }
  if (!path.length) return null;

  // build segments
  const segments = path.map((n, i) => {
    let s = n.tag;
    if (includeAttributes && n.attrName && n.attrValue) {
      s += `[@${n.attrName}='${n.attrValue}']`;
    }
    if (includeIndices && i > 0) {
      const ix = n.customIndex != null ? n.customIndex : n.idx;
      if (!(ix === 1 && ignoreTags.has(n.tag))) s += `[${ix}]`;
    }
    return s;
  });
  return '/' + segments.join('/');
}

module.exports = { activate, deactivate };
