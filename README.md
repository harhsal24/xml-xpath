# XML XPath Extension

Easily generate XPath expressions in Visual Studio Code directly from your XML files with customizable modes, templates, and intelligent indexing.

![StatusBar Preview](https://img.shields.io/badge/XPath-Copy%20from%20cursor-blue.svg)

## ✨ Features

- 📋 **Copy XPath** from the current cursor position
- 🔧 Configure **XPath generation mode**:
  - Include/exclude indices
  - Include/exclude attributes
- ⚙️ **Custom predicate templates** for fine-grained control
- 🔁 Intelligent **index skipping** (e.g., `[1]`)
- 🧠 Respects `xlink:label`-based indexing (e.g., `label_12`)
- 🪄 **Parent tag scoping** to build relative XPaths
- 🔍 Status bar shows **live XPath** for selected element
- 📁 Works for `.xml`, `.xsd`, `.xsl`, `.xaml`, `.svg`, `.xhtml`, `.wsdl`, and more!

---

## 📸 Demo

![Demo GIF](https://user-images.githubusercontent.com/your-demo-gif.gif)

---

## ⚙️ Commands

| Command | Description |
|--------|-------------|
| `XML XPath: Copy XPath from Cursor` | Copies XPath for the current element |
| `XML XPath: Set Parent Tag` | Sets a tag from which XPath should be generated |
| `XML XPath: Clear Parent Tag` | Clears parent scoping and returns to full XPath |
| `XML XPath: Set XPath Mode` | Choose between indices, attributes, both, or simple |
| `XML XPath: Set Preferred Attributes` | Choose preferred attributes for XPath predicates |
| `XML XPath: Set Ignore-Index Tags` | Tags for which index should be skipped |
| `XML XPath: Set Predicate Template` | Customize how predicates are rendered |
| `XML XPath: Toggle Disable Leaf Index` | Skip `[n]` on last segment |
| `XML XPath: Toggle Skip Single Index` | Skip `[1]` when element is unique at its level |
| `XML XPath: Toggle Use XLink Label Index` | Use index parsed from `xlink:label` |
| `XML XPath: Toggle Parent-Scoped Indexing` | Use parent-relative counters for indices |
| `XML XPath: Toggle Ignore Parent Segment` | Remove the parent tag segment from the XPath |

🪄 **Pro Tip**: All commands are prefixed with `XML XPath:` — just type that in the command palette to see them!

---

## 🛠️ Configuration Settings

You can customize the extension via VS Code settings:

```jsonc
{
  "xmlXpath.parentTag": "section",
  "xmlXpath.mode": {
    "includeIndices": true,
    "includeAttributes": true
  },
  "xmlXpath.preferredAttributes": ["id", "name"],
  "xmlXpath.ignoreIndexTags": ["div", "span"],
  "xmlXpath.predicateTemplate": "[@{attr1}='{attr1V}']",
  "xmlXpath.disableLeafIndex": false,
  "xmlXpath.skipSingleIndex": true,
  "xmlXpath.useXlinkLabelIndex": false,
  "xmlXpath.useParentScopedIndices": false,
  "xmlXpath.ignoreParentSegment": false
}
