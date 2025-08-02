# XML XPath Extension

Easily generate XPath expressions in Visual Studio Code directly from your XML files with advanced smart relative paths, namespace support, virtual roots, and customizable templates.

## ✨ Features

- 📋 **Copy XPath** from cursor position with `Ctrl+Shift+C`
- 🔍 **Search with XPath** - Find elements using XPath expressions (`Ctrl+Shift+F`)
- 🌍 **Universal XPath** - Generate XPaths that work across different files
- 📊 **Live XPath preview** in status bar
- 🚀 **Smart Relative Paths** - Generate concise XPaths using significant elements
- 🎨 **Multi-line formatting** for readable complex XPaths
- ⚡ **Single-line mode** for compact expressions
- 🏷️ **Virtual root support** - Start XPaths from any ancestor element
- 🔗 **Namespace-aware** generation with custom prefixes
- 🎯 **Attribute-based indexing** - Group elements by attribute values
- 📁 Works with `.xml`, `.xsd`, `.xsl`, `.xaml`, `.svg`, `.xhtml`, `.wsdl`, and more!

## ⚡ Quick Start

1. Open any XML file
2. Place your cursor on an element
3. Use `Ctrl+Shift+C` to copy the XPath
4. Or click the XPath in the status bar

## ⚙️ Commands & Shortcuts

### 🎯 **Core Commands**
| Command | Description | Shortcut |
|---------|-------------|----------|
| `XML XPath: Copy XPath from Cursor` | Copies XPath for current element | `Ctrl+Shift+C` |
| `XML XPath: Search with XPath` | Find elements using XPath | `Ctrl+Shift+F` |
| `XML XPath: Copy Universal XPath` | Generate XPath with universal settings | - |

### 🚀 **Smart Relative Path Commands**
| Command | Description | Shortcut |
|---------|-------------|----------|
| `XML XPath: Toggle Smart Relative Path` | Enable/disable smart relative mode | `Ctrl+Shift+X` |
| `XML XPath: Set Smart Relative Namespace Prefix` | Configure namespace prefix (e.g., 'd', 'ns') | - |
| `XML XPath: Set Smart Relative Significant Attributes` | Set attributes that make elements significant | - |
| `XML XPath: Toggle Smart Relative Single Line` | Switch between multi-line and single-line format | - |
| `XML XPath: Set Smart Relative Virtual Root` | Set element to start XPath from | - |
| `XML XPath: Toggle Virtual Root Mode` | Include/exclude virtual root in output | - |
| `XML XPath: Toggle Ignore Last Element` | Exclude target element (show container path) | - |

### 🔧 **Configuration Commands**
| Command | Description |
|---------|-------------|
| `XML XPath: Set Parent Tag` | Sets a tag from which XPath should be generated |
| `XML XPath: Set XPath Mode` | Choose between indices, attributes, both, or simple |
| `XML XPath: Set Preferred Attributes` | Choose preferred attributes for predicates |
| `XML XPath: Set Predicate Template` | Customize how predicates are rendered |

### 📊 **Index Control Commands**
| Command | Description |
|---------|-------------|
| `XML XPath: Toggle Skip Single Index` | Skip [1] when element is unique |
| `XML XPath: Set Force Index [1] Tags` | Tags that must always show [1] |
| `XML XPath: Set Exceptions to Force Index [1]` | Override force index for specific tags |
| `XML XPath: Toggle Attribute-Based Indexing` | Index elements by attribute values |
| `XML XPath: Toggle Disable Leaf Index` | Skip [n] on the last segment |

### 🌐 **Namespace Commands**
| Command | Description |
|---------|-------------|
| `XML XPath: Toggle Include Namespaces` | Include namespace prefixes |
| `XML XPath: Toggle Include Default Namespaces` | Handle default namespaces |

### 🔬 **Advanced Commands**
| Command | Description |
|---------|-------------|
| `XML XPath: Toggle Use XLink Label Index` | Use index parsed from xlink:label |
| `XML XPath: Set xlink:label Pattern` | Configure xlink:label number extraction |
| `XML XPath: Toggle Parent-Scoped Indexing` | Use parent-relative counters |

## 🎛️ XPath Generation Modes

### 1. **Absolute Path** (Default)
```xpath
/catalog[1]/products[1]/category[1]/product[1]/name[1]
```

### 2. Smart Relative Path (Multi-line)
```xpath
/ns:catalog
    //ns:category[@type='electronics']
    //ns:product[@id='laptop-001']
    //ns:name[1]
```
### 3. Smart Relative Path (Single-line)
```xpath
//ns:category[@type='electronics']//ns:product[@id='laptop-001']//ns:name[1]
```
### 4. Virtual Root Mode
```xpath
//ns:category[@type='electronics']//ns:product[@id='laptop-001']//ns:name[1]
```

Turn complex XML navigation into simple, readable expressions with the power of smart relative paths and advanced indexing.

⭐ If this extension helps you, please consider leaving a review on the VS Code Marketplace!