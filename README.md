const vscode = require('vscode');

let statusBarItem;

function activate(context) {
    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'xpath.copyXPath';
    context.subscriptions.push(statusBarItem);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('xpath.setMode', setMode)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('xpath.setPreferredAttributes', setPreferredAttributes)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('xpath.setIgnoreIndexTags', setIgnoreIndexTags)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('xpath.setParentTag', setParentTag)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('xpath.copyXPath', copyXPath)
    );

    // Update on cursor move or active editor change
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(updateStatusBar)
    );
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(updateStatusBar)
    );

    updateStatusBar();
}

function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}

async function setMode() {
    const modes = [
        { label: 'With Indices & Attributes', value: 'both' },
        { label: 'Attributes Only', value: 'attrs' },
        { label: 'Indices Only', value: 'index' },
        { label: 'Simple Path', value: 'simple' },
    ];
    const choice = await vscode.window.showQuickPick(modes, { placeHolder: 'Select XPath generation mode' });
    if (!choice) return;
    await vscode.workspace.getConfiguration('xpath').update('mode', choice.value, vscode.ConfigurationTarget.Global);
    updateStatusBar();
}

async function setPreferredAttributes() {
    const input = await vscode.window.showInputBox({ prompt: 'Comma-separated list of preferred attributes (e.g. id,name,class)' });
    if (input === undefined) return;
    const list = input.split(',').map(s => s.trim()).filter(Boolean);
    await vscode.workspace.getConfiguration('xpath').update('preferredAttrs', list, vscode.ConfigurationTarget.Global);
    updateStatusBar();
}

async function setIgnoreIndexTags() {
    const input = await vscode.window.showInputBox({ prompt: 'Comma-separated list of tags to ignore default [1] index' });
    if (input === undefined) return;
    const list = input.split(',').map(s => s.trim()).filter(Boolean);
    await vscode.workspace.getConfiguration('xpath').update('ignoreIndexTags', list, vscode.ConfigurationTarget.Global);
    updateStatusBar();
}

async function setParentTag() {
    const input = await vscode.window.showInputBox({ prompt: 'Ancestor tag name to start relative XPath (leave empty for full)' });
    if (input === undefined) return;
    const tag = input.trim() || null;
    await vscode.workspace.getConfiguration('xpath').update('parentTag', tag, vscode.ConfigurationTarget.Global);
    updateStatusBar();
}

function copyXPath() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const xpath = computeXPathForEditor(editor);
    vscode.env.clipboard.writeText(xpath);
    vscode.window.showInformationMessage(`XPath copied: ${xpath}`);
}

function updateStatusBar() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        statusBarItem.hide();
        return;
    }
    const xpath = computeXPathForEditor(editor);
    statusBarItem.text = `$(code) ${xpath}`;
    statusBarItem.tooltip = 'Click to copy XPath';
    statusBarItem.show();
}

function computeXPathForEditor(editor) {
    const doc = editor.document;
    const cursorPos = editor.selection.active;
    const offset = doc.offsetAt(cursorPos);
    const text = doc.getText();
    return computeXPath(text, offset);
}

// Core XPath builder
function computeXPath(xmlText, offset) {
    const config = vscode.workspace.getConfiguration('xpath');
    const mode = config.get('mode', 'both');
    const preferred = config.get('preferredAttrs', []);
    const ignoreTags = new Set(config.get('ignoreIndexTags', []));
    const parentTag = config.get('parentTag', null);

    // Tokenize XML into events
    const tokenRegex = /<\s*(\/)?([\w:\-\.]+)([^>]*)>/g;
    let match;
    const events = [];
    while ((match = tokenRegex.exec(xmlText))) {
        const isClose = !!match[1];
        const tag = match[2];
        const attrsText = match[3] || '';
        const pos = match.index;
        const endPos = tokenRegex.lastIndex;
        const attrs = {};
        attrsText.replace(/([\w:\-\.]+)\s*=\s*['\"]([^'\"]*)['\"]/g, (_, n, v) => { attrs[n] = v; });
        events.push({ type: isClose ? 'close' : 'open', tag, attrs, pos, endPos });
    }

    // Walk events to build path hierarchy at offset
    const stack = [];
    const siblingCounters = [];
    for (const ev of events) {
        if (ev.pos > offset) break;
        if (ev.type === 'open') {
            // ensure counter for this depth
            const depth = stack.length;
            if (!siblingCounters[depth]) siblingCounters[depth] = {};
            const cnts = siblingCounters[depth];
            cnts[ev.tag] = (cnts[ev.tag] || 0) + 1;
            // push element
            stack.push({ tag: ev.tag, attrs: ev.attrs, idx: cnts[ev.tag] });
        } else {
            // close: pop matching tag
            if (stack.length && stack[stack.length - 1].tag === ev.tag) {
                stack.pop();
            }
        }
    }

    // Trim stack to parentTag if set
    let pathStack = stack;
    if (parentTag) {
        const idx = stack.findIndex(e => e.tag === parentTag);
        if (idx >= 0) {
            pathStack = stack.slice(idx);
        }
    }

    // Build segments
    const segments = pathStack.map(node => {
        let seg = node.tag;
        // attributes
        if ((mode === 'both' || mode === 'attrs') && node.attrs) {
            for (const attrName of preferred) {
                if (node.attrs[attrName]) {
                    seg += `[@${attrName}='${node.attrs[attrName]}']`;
                    break;
                }
            }
        }
        // index
        const needIndex = (mode === 'both' || mode === 'index') && (!ignoreTags.has(node.tag) || node.idx !== 1);
        if (needIndex) {
            seg += `[${node.idx}]`;
        }
        return seg;
    });

    // Prepend slash
    const path = '/' + segments.join('/');
    return path;
}

module.exports = { activate, deactivate };
