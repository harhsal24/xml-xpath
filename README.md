# XML XPath Extension

[![Version](https://img.shields.io/visual-studio-marketplace/v/HB24.xml-xpath-extension?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=HB24.xml-xpath-extension)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/HB24.xml-xpath-extension?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=HB24.xml-xpath-extension)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/HB24.xml-xpath-extension?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=HB24.xml-xpath-extension)

Easily generate, search, and navigate XPath expressions in Visual Studio Code directly from your XML files. Features advanced relative path landmarks, namespace support, virtual roots, customizable predicate templates, and robust indexing options.

---

## 🚀 Key Features

- 📋 **Copy XPath from Cursor** — Reconstruct and copy the exact XPath for the element at your cursor position instantly (`Ctrl+Shift+C`).
- 🔍 **Search and Navigate with XPath** — Find and jump to elements using XPath queries (`Ctrl+Shift+F` or `Alt+Shift+X`). Handles full and partial matching.
- 🌍 **Universal XPath** — Generate clean, standardized XPaths designed to work reliably across different XML files.
- 📊 **Real-time Status Bar Preview** — Live XPath preview updates as you navigate, with click-to-copy.
- 🔗 **Smart Relative Paths** — Generate concise relative paths (`//`) leveraging custom landmark elements and anchor points.
- 🏷️ **Flexible Indexing Strategies** — Choose between Parent-Scoped, Global Depth, Attribute-Based, or XLink Label-Based indexing.
- 🌐 **Namespace-Aware Engine** — Handles prefix preservation and default namespaces with customizable prefixes (e.g. `d:tag`).
- 🎨 **Custom Predicate Templates** — Completely customize predicate rendering using token variables and conditions.
- 📁 **Wide Format Support** — Fully compatible with `.xml`, `.xsd`, `.xsl`, `.wsdl`, `.xaml`, `.svg`, `.xhtml`, and more.

---

## 📖 How to Use the Extension

### 1. Copying XPath from Cursor
1. Open any XML file.
2. Place your cursor on any XML tag, attribute, or content.
3. Press `Ctrl+Shift+C` (or search for `XML XPath: Copy XPath from Cursor` in the Command Palette).
4. The XPath is copied directly to your clipboard, and a confirmation notification will appear.

### 2. Live Status Bar Preview
- Look at the bottom-left of your VS Code Status Bar.
- The XPath of the active XML element is shown in real-time.
- **Click the Status Bar item** to immediately copy the full XPath to your clipboard.

### 3. Searching with XPath
1. Press `Ctrl+Shift+F` (or `Alt+Shift+X` / command `XML XPath: Search with XPath`).
2. The extension reads your clipboard. If it contains a valid XPath starting with `/` or `//`, it executes the search immediately.
3. If the clipboard doesn't contain a valid XPath, a search box prompts you to enter one.
4. **Full Match:** The editor highlights and centers the matching XML node.
5. **Partial Match:** If the exact path doesn't exist, it highlights the deepest matching parent/ancestor tag and warns you with a status message (e.g. `Partial match (2/3) — selected <parent>`).

---

## ⌨️ Keyboard Shortcuts & Context Menus

### 🎯 Keyboard Shortcuts
| Command Title | Default Shortcut | Action |
|---|---|---|
| `XML XPath: Copy XPath from Cursor` | `Ctrl+Shift+C` | Copies generated XPath from editor cursor |
| `XML XPath: Search with XPath` | `Ctrl+Shift+F` | Queries XPath and navigates to matching tag |
| `XML XPath: Search with XPath` (Global) | `Alt+Shift+X` | Queries XPath when active file is XML |

### 🖱️ Editor Context Menu Options
Right-click anywhere in an XML file to quickly toggle core indexing settings:
- **XML XPath: Copy XPath from Cursor**
- **XML XPath: Toggle Disable Leaf Index**
- **XML XPath: Toggle Skip Single Index**
- **XML XPath: Toggle Use XLink Label Index**

---

## 🛠️ Complete Command Reference

Use the **Command Palette** (`Ctrl+Shift+P` / `F1`) to run these commands:

### ⚙️ Path & Output Controls
- `XML XPath: Toggle Use Relative Path` — Switch between absolute (`/`) and relative (`//`) XPath generation.
- `XML XPath: Recalculate XPath from Cursor` — Force recalculation of status bar and clipboard XPath.
- `XML XPath: Copy Universal XPath from Cursor` — Generate and copy an XPath with standardized baseline settings (ideal for sharing across files).
- `XML XPath: Set Parent Tag` — Set a parent tag name to act as a virtual root. XPath will generate starting from this tag.
- `XML XPath: Clear Parent Tag` — Reset virtual root and generate paths from the document root.
- `XML XPath: Toggle Ignore Parent Segment` — Omit the designated parent tag itself, starting the path from its children.
- `XML XPath: Set XPath Mode` — Quick choice dialog for generation mode:
  - *Both:* Tag path, attributes, and indices.
  - *Attributes Only:* Omit indices; use attribute matches.
  - *Indices Only:* Omit attribute predicates; use numeric indices.
  - *Simple:* Output tag path only (e.g. `/root/parent/child`).

### 📊 Indexing & Predicate Controls
- `XML XPath: Toggle Skip Single Index` — Omit `[1]` when an element is the only child of its tag name under that parent.
- `XML XPath: Toggle Disable Leaf Index` — Omit indices on the final (leaf) segment of the generated XPath.
- `XML XPath: Set Ignore-Index Tags` — Set tag names (comma-separated) for which `[1]` index is always omitted.
- `XML XPath: Set Force Index [1] Tags` — Specify tags that must always show `[1]`, even if `skipSingleIndex` is ON.
- `XML XPath: Set Exceptions to Force Index [1]` — Specify tags that never show `[1]`, overriding the force-index list.
- `XML XPath: Toggle Attribute-Based Indexing` — Group and count index sequences separately for elements with different attribute values.
- `XML XPath: Set Attribute for Attribute-Based Indexing` — Select or type attributes to group by for attribute-based indexing.
- `XML XPath: Set Preferred Attributes` — Configure attributes (comma-separated) prioritized when constructing predicates (e.g. `id, name, key`).
- `XML XPath: Set Predicate Template` — Select predefined templates or define custom predicate tokens.

### 🌐 Namespace Controls
- `XML XPath: Toggle Include Namespaces` — Enable or disable namespace prefixes in the XPath.
- `XML XPath: Toggle Include Default Namespaces` — Handle default (unprefixed) namespaces.

### 🚀 Relative Mode Customization
- `XML XPath: Set Relative Must-Include Tags` — Specify landmark tags that must never be omitted in relative mode.
- `XML XPath: Set Relative Must-Ignore Tags` — Specify tags to always ignore or skip over in relative paths.
- `XML XPath: Set Relative 'Don't Ignore After' Anchor` — Define an ancestor tag name; everything past this ancestor will be kept in full.
- `XML XPath: Clear Relative 'Don't Ignore After' Anchor` — Clears the relative anchor tag.

### 🔬 Advanced Custom Indexing (xlink:label)
- `XML XPath: Toggle Use XLink Label Index` — Extract numeric suffixes from `xlink:label` attributes to use as element indices.
- `XML XPath: Set xlink:label Pattern` — Configure pattern types (`any`, `startsWith`, `contains`, `endsWith`, `exactPrefix`, `regex`) to extract indices.

---

## ⚙️ Configuration Properties

Add these to your VS Code `settings.json` file to customize behavior:

```jsonc
{
  // Generate relative XPath (using //) instead of absolute path
  "xmlXpath.useRelativePath": false,

  // XPath generation mode options: include/exclude indices and attributes
  "xmlXpath.mode": {
    "includeIndices": true,
    "includeAttributes": true
  },

  // Preferred attributes for XPath predicates, evaluated in order
  "xmlXpath.preferredAttributes": ["id", "name", "key"],

  // Parent tag from which to generate relative XPath
  "xmlXpath.parentTag": null,

  // When true, omit the parentTag itself from the generated XPath
  "xmlXpath.ignoreParentSegment": false,

  // Reset child-counters per parent (true) or use global depth counters (false)
  "xmlXpath.useParentScopedIndices": true,

  // Omit the index sequence [n] on the final segment of the path
  "xmlXpath.disableLeafIndex": false,

  // Omit all [1] indices when an element is the only child of its tag name
  "xmlXpath.skipSingleIndex": false,

  // Tags for which index [1] should always be omitted
  "xmlXpath.ignoreIndexTags": [],

  // Tags that must always show [1] even when skipSingleIndex is true
  "xmlXpath.forceIndexOneFor": [],

  // Tags that are exceptions to forceIndexOneFor (will never show [1])
  "xmlXpath.exceptionsToIndexOneForcing": [],

  // Separate index sequences based on attribute values
  "xmlXpath.useAttributeBasedIndexing": false,

  // Attributes used for attribute-based indexing. If empty, uses preferredAttributes.
  "xmlXpath.attributeBasedIndexingAttribute": "",

  // Include namespace prefixes in generated XPath
  "xmlXpath.includeNamespaces": false,

  // Enable handling of elements in default namespaces
  "xmlXpath.includeDefaultNamespaces": false,

  // Prefix to apply to default namespace elements
  "xmlXpath.defaultNamespacePrefix": "d",

  // Predicate rendering template.
  "xmlXpath.predicateTemplate": "[@{attr1}='{attr1V}']",

  // Extract element index numbers from xlink:label
  "xmlXpath.useXlinkLabelIndex": false,

  // Pattern configuration for parsing xlink:label values
  "xmlXpath.xlinkLabelPattern": {
    "type": "any",
    "pattern": ""
  },

  // Landmark tags that must be included when generating relative XPath
  "xmlXpath.relativeMustIncludeTags": [],

  // Tags that will always be ignored and skipped in relative paths
  "xmlXpath.relativeMustIgnoreTags": [],

  // Ancestor tag name past which elements are never skipped in relative mode
  "xmlXpath.relativeDontIgnoreAfter": "",

  // Maximum file size in bytes to parse. Larger files use faster partial parsing.
  "xmlXpath.maxParseSize": 1000000
}
```

---

## 📖 Feature Deep Dive

### 1. Indexing Strategies
The extension supports three primary ways to calculate numeric indices `[n]`:

- **Parent-Scoped Mode (Default):** Counters reset for each parent block.
  - Path: `/company[1]/department[1]/employee[2]`
- **Global Depth Mode:** Counters count elements of the same tag name at that depth across the entire document.
  - Path: `/company[1]/department[1]/employee[4]`
- **Attribute-Based Indexing:** Elements with different attribute values are grouped into distinct sequences.
  - *Example:* If you have two `<item type="A">` and one `<item type="B">`, they are indexed as:
    - `<item type="A">` → `/item[@type='A'][1]` and `/item[@type='A'][2]`
    - `<item type="B">` → `/item[@type='B'][1]`

---

### 2. Relative Paths & Landmarks
When `xmlXpath.useRelativePath` is enabled, the path is simplified using significant landmark nodes:
- **Significant Nodes:** Root element, the target element, nodes containing preferred attributes, and tags in `relativeMustIncludeTags`.
- **Must-Ignore Nodes:** Tags in `relativeMustIgnoreTags` are dropped.
- **Anchor point:** If `relativeDontIgnoreAfter` matches an ancestor, all elements under that ancestor are preserved in full detail.

*Example output:*
```xpath
//catalog//product[@id='laptop-001']//specs//detail[2]
```

---

### 3. Namespace Handling
If `xmlXpath.includeNamespaces` is ON, elements are prefixed:
- Prefixes defined in standard declarations (e.g. `xmlns:ns="uri"`) are resolved and used.
- If default namespaces are enabled (`includeDefaultNamespaces` is ON), elements belonging to default namespaces are mapped with the configured `defaultNamespacePrefix` (default `d:`).

*Example namespace path:*
```xpath
/d:catalog/ns:products/ns:item[1]
```

---

### 4. Custom Predicate Templates
You can format predicates beyond simple attribute matching using `xmlXpath.predicateTemplate`.

#### Available Template Tokens:
| Token | Replaced With | Example Result |
|---|---|---|
| `{tag}` | Tag name | `item` |
| `{idx}` / `{pos}` | Calculated numeric index | `2` |
| `{at}` | Simple `@` character | `@` |
| `{attr1}` | The matched preferred attribute name | `id` |
| `{attr1V}` | The value of the matched preferred attribute | `prod-100` |
| `{attrs}` | All element attributes separated by `and` | `@id='1' and @class='list'` |
| `{attrCount}` | Total number of attributes on the node | `2` |
| `{attr:name}` | Value of the specific attribute `name` | `custom-value` |
| `{lastPos}` | Renders string literal `last()` | `last()` |
| `{isFirst}` | Renders `true()` or `false()` based on index == 1 | `true()` |
| `{isLast}` | Renders expression `position()=last()` | `position()=last()` |
| `{xllv}` | Raw xlink:label attribute value | `label_2` |
| `{xllvI}` | Numeric index extracted from xlink:label | `2` |
| `{attr1Lower}` / `{attr1Upper}` | Lower/Upper case of preferred attribute name | `id` / `ID` |
| `{attr1VLower}` / `{attr1VUpper}` | Lower/Upper case of preferred attribute value | `prod-100` / `PROD-100` |

#### Conditional Statements:
You can use ternary-like syntax `{if:condition:ifTrue:ifFalse}`:
- `{if:hasId:ifTrue:ifFalse}` — Check if the element has an `id` attribute.
- `{if:hasClass:ifTrue:ifFalse}` — Check if the element has a `class` attribute.
- `{if:isFirst:ifTrue:ifFalse}` — Check if the element is the first occurrence.

*Example Template:*
```json
"xmlXpath.predicateTemplate": "[@{attr1}='{attr1V}'][position()={idx}]"
```

---

## ⚡ Performance Optimization

For huge XML files, the extension handles parsing asynchronously and limits full document scans using `xmlXpath.maxParseSize` (Default is 1MB). If a file exceeds this limit:
1. It parses elements around the cursor selectively.
2. Status Bar and Clipboard generation remain highly responsive.
3. Node structure is parsed dynamically to prevent editor lag or memory spikes.

---

## ⭐ Feedback

If this extension saves you time, please support the project by leaving a rating or review on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=HB24.xml-xpath-extension)!