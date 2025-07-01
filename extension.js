const vscode = require('vscode');
const CONFIG_SECTION = 'xmlXpath';
let statusBarItem;

function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'xmlXpath.copyXPath';
  context.subscriptions.push(statusBarItem);

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
    vscode.commands.registerCommand('xmlXpath.setTemplate', setTemplate)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('xmlXpath.copyXPath', copyXPath)
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(update)
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(update)
  );
  context.subscriptions.push(vscode.commands.registerCommand('xmlXpath.toggleDisableLeafIndex', toggleDisableLeafIndex));
  context.subscriptions.push(vscode.commands.registerCommand('xmlXpath.toggleSkipSingleIndex', toggleSkipSingleIndex));

  update();
}


function deactivate() {
  if (statusBarItem) statusBarItem.dispose();
}

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

// Commands
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

async function setTemplate() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const current = cfg.get('predicateTemplate', "[@{attr1}='{attr1V}']");
  const tpl = await vscode.window.showInputBox({
    prompt: 'Predicate template using tokens {tag},{attr1},{attr1V},{xllv},{xllvI},{idx}',
    value: current
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
    // show the full path on hover
    statusBarItem.tooltip = xpath;
   statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

function buildXPath(document, position) {
  const xml = document.getText();
  const offset = document.offsetAt(position);
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const parentTag        = cfg.get('parentTag', null);
  const { includeIndices, includeAttributes } = cfg.get('mode', { includeIndices: true, includeAttributes: true });
  const preferred        = cfg.get('preferredAttributes', []);
  const ignoreTags       = new Set(cfg.get('ignoreIndexTags', []));
  const tpl              = includeAttributes ? cfg.get('predicateTemplate', "[@{attr1}='{attr1V}']") : null;
  const disableLeafIndex = cfg.get('disableLeafIndex', false);
  const skipSingleIndex  = cfg.get('skipSingleIndex', false);

  // tokenize up to cursor
  const tokenRegex = /<(\/)?([\w:\-\.]+)([^>]*?)(\/?)>/g;
  const events = [];
  let m;
  while ((m = tokenRegex.exec(xml))) {
    const isClose     = !!m[1];
    const tag         = m[2];
    const attrsText   = m[3] || '';
    const selfClose   = !!m[4];
    const pos         = m.index;
    const attrs       = {};
    let customIndex, customIndexRaw;

    attrsText.replace(/([\w:\-\.]+)\s*=\s*"([^"]*)"/g, (_, k, v) => {
      if (k === 'xlink:lable') {
        customIndexRaw = v;
        const num = v.match(/(\d+)$/);
        if (num) customIndex = Number(num[1]);
      } else if (!k.startsWith('xmlns')) {
        attrs[k] = v;
      }
    });

    if (!isClose) {
      events.push({ type: 'open', tag, attrs, pos, customIndex, customIndexRaw });
      if (selfClose) events.push({ type: 'close', tag, pos });
    } else {
      events.push({ type: 'close', tag, pos });
    }
    if (pos > offset) break;
  }

  // build stack + counters
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
      stack.push({ tag: ev.tag, idx, customIndex: ev.customIndex, customIndexRaw: ev.customIndexRaw, attrName: pickName, attrValue: pickVal });
    } else if (stack.length && stack[stack.length - 1].tag === ev.tag) {
      stack.pop();
    }
  }

  // apply parentTag slicing
  let path = stack;
  if (parentTag) {
    const i = stack.findIndex(n => n.tag === parentTag);
    if (i >= 0) path = stack.slice(i);
  }
  if (!path.length) return null;

  // build segments
  return '/'
    + path
        .map((n, i) => {
          const isLeaf = i === path.length - 1;
          let s = n.tag;

          // attributes-based predicates
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
            s += `[@${n.attrName}='${n.attrValue}']`;
          }

          if (!(disableLeafIndex && isLeaf) && includeIndices) {
            let ix = n.customIndex != null ? n.customIndex : n.idx;
            // **always** treat the leaf’s index as 1
            if (isLeaf) ix = 1;

            // only render the index if it’s not a “skip [1]” case
            if (!(skipSingleIndex && ix === 1) && !(ix === 1 && ignoreTags.has(n.tag))) {
              s += `[${ix}]`;
            }
          }

          return s;
        })
        .join('/');
}

module.exports = { activate, deactivate };


  