const vscode = require('vscode');
// const { CodeLensProvider, Range, Command } = require('vscode');

// after activate()
// function registerCodeLens(context) {
//   class XPathCodeLensProvider {
//     provideCodeLenses(document) {
//       // figure out the element under the cursor’s line
//       const editor = vscode.window.activeTextEditor;
//       if (!editor || editor.document !== document) return [];

//       const line = editor.selection.active.line;
//       const pos = new vscode.Position(line, 0);
//       const parentTag = context.workspaceState.get('xmlXpath.parentTag');
//       if (!parentTag) return [];

//       const xpath = getXPathFromCursor(document, pos, parentTag);
//       if (!xpath) return [];

//       // show a single CodeLens at start of the line
//       return [
//         new vscode.CodeLens(
//           new Range(line, 0, line, 0),
//           {
//             title: `$(symbol-parameter) ${xpath}`,
//             command: 'xmlXpath.copyXPath',
//             arguments: []
//           }
//         )
//       ];
//     }
//   }

//   context.subscriptions.push(
//     vscode.languages.registerCodeLensProvider(
//       { scheme: 'file', language: 'xml' },
//       new XPathCodeLensProvider()
//     )
//   );
// }




// Utility to compute XPath with indices
function computeXPath(path) {
  return path.map(p => `${p.tag}[${p.index}]`).join('/');
}

// Find XML node under cursor and build path from specified parent
function getXPathFromCursor(document, position, parentTag) {
  const xmlText = document.getText();
  const cursorOffset = document.offsetAt(position);

  const stack = [];
  const pathStack = [];
  const counts = {};
  const tagRegex = /<(\/?)([\w:\-\.]+)([^>]*)>/g;
  let match;

  while ((match = tagRegex.exec(xmlText))) {
    const isClosing = !!match[1];
    const tag = match[2];
    const start = match.index;
    const end = tagRegex.lastIndex;
    if (!isClosing) {
      counts[tag] = (counts[tag] || 0) + 1;
      pathStack.push({ tag, index: counts[tag] });
      stack.push(tag);
      if (cursorOffset >= start && cursorOffset <= end) break;
    } else {
      counts[tag] = Math.max((counts[tag] || 1) - 1, 0);
      pathStack.pop();
      stack.pop();
      if (cursorOffset >= start && cursorOffset <= end) break;
    }
  }

  const idxParent = pathStack.map(p => p.tag).lastIndexOf(parentTag);
  if (idxParent < 0) return null;
  const relative = pathStack.slice(idxParent);
  return '/' + computeXPath(relative);
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// registerCodeLens(context);
  const stateKey = 'xmlXpath.parentTag';
  // Create status bar item once
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.tooltip = 'XPath from configured parent';
  context.subscriptions.push(statusBarItem);

  // Command: set or change parent tag
  const setParentCmd = vscode.commands.registerCommand('xmlXpath.setParent', async () => {
    const parentTag = await vscode.window.showInputBox({ prompt: 'Enter parent tag for XPath' });
    if (parentTag) {
      await context.workspaceState.update(stateKey, parentTag);
      statusBarItem.text = `Parent: ${parentTag}`;
      statusBarItem.show();
      vscode.window.showInformationMessage(`Parent tag set to '${parentTag}'`);
    }
  });
  context.subscriptions.push(setParentCmd);

  // Command: clear parent tag
  const clearParentCmd = vscode.commands.registerCommand('xmlXpath.clearParent', async () => {
    await context.workspaceState.update(stateKey, undefined);
    statusBarItem.hide();
    vscode.window.showInformationMessage('Parent tag cleared');
  });
  context.subscriptions.push(clearParentCmd);

  // Update and show XPath when cursor moves or editor changes
  const updateXPath = async () => {
    let parentTag = context.workspaceState.get(stateKey);
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // If parent not set, prompt user to set it
    if (!parentTag) {
      await vscode.commands.executeCommand('xmlXpath.setParent');
      return;
    }

    const pos = editor.selection.active;
    const xpath = getXPathFromCursor(editor.document, pos, parentTag);
    if (xpath) {
      statusBarItem.text = `XPath: ${xpath}`;
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  };

  // Event subscriptions
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(updateXPath));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateXPath));

  // Initial call to show status bar if applicable
  updateXPath();

  // Command: copy current XPath to clipboard
  const copyCmd = vscode.commands.registerCommand('xmlXpath.copyXPath', async () => {
    const parentTag = context.workspaceState.get(stateKey);
    const editor = vscode.window.activeTextEditor;
    if (!parentTag) {
      vscode.window.showErrorMessage('Parent tag not set. Run "Set Parent Tag" first.');
      return;
    }
    if (!editor) return;
    const xpath = getXPathFromCursor(editor.document, editor.selection.active, parentTag);
    if (xpath) {
      await vscode.env.clipboard.writeText(xpath);
      vscode.window.showInformationMessage(`XPath copied: ${xpath}`);
    } else {
      vscode.window.showErrorMessage(`Element not within parent '${parentTag}'`);
    }
  });
  context.subscriptions.push(copyCmd);
}

function deactivate() {}

module.exports = { activate, deactivate };
