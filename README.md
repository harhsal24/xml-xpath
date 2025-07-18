XML XPath Extension
Easily generate XPath expressions in Visual Studio Code directly from your XML files with customizable modes, templates, and intelligent indexing.

StatusBar Preview

✨ Features
📋 Copy XPath from the current cursor position
🌍 Universal XPath - Generate XPaths that work across different files
🔍 Search with XPath - Find elements using XPath expressions
🔧 Multiple XPath generation modes:
Include/exclude indices
Include/exclude attributes
Attribute-based indexing (group elements by attribute values)
⚙️ Custom predicate templates with powerful token replacement
🎯 Fine-grained index control:
Skip [1] for unique elements
Force [1] for specific tags
Exception lists for ultimate control
🧠 xlink:label indexing with pattern matching
🪄 Parent tag scoping to build relative XPaths
📊 Parent-scoped indexing - Reset counters per parent element
🔍 Live XPath preview in status bar
📁 Works with .xml, .xsd, .xsl, .xaml, .svg, .xhtml, .wsdl, and more!
📸 Demo
Demo GIF

⚡ Quick Start
Open any XML file
Place your cursor on an element
Use Ctrl+Shift+C to copy the XPath
Or click the XPath in the status bar
⚙️ Commands
Core Commands
Command	Description	Shortcut
XML XPath: Copy XPath from Cursor	Copies XPath for the current element	Ctrl+Shift+C
XML XPath: Copy Universal XPath	Copies XPath with universal settings	-
XML XPath: Search with XPath	Find elements using XPath	Ctrl+Shift+F
Configuration Commands
Command	Description
XML XPath: Set Parent Tag	Sets a tag from which XPath should be generated
XML XPath: Clear Parent Tag	Clears parent scoping and returns to full XPath
XML XPath: Set XPath Mode	Choose between indices, attributes, both, or simple
XML XPath: Set Preferred Attributes	Choose preferred attributes for XPath predicates
XML XPath: Set Predicate Template	Customize how predicates are rendered
Index Control Commands
Command	Description
XML XPath: Set Ignore-Index Tags	Tags that should never show [1]
XML XPath: Set Force Index [1] Tags	Tags that must always show [1]
XML XPath: Set Exceptions to Force Index [1]	Override force index for specific tags
XML XPath: Toggle Disable Leaf Index	Skip [n] on the last segment
XML XPath: Toggle Skip Single Index	Skip [1] when element is unique
XML XPath: Toggle Attribute-Based Indexing	Index elements by attribute values
Advanced Features
Command	Description
XML XPath: Toggle Use XLink Label Index	Use index parsed from xlink:label
XML XPath: Set xlink:label Pattern	Configure how to extract numbers from xlink:label
XML XPath: Toggle Parent-Scoped Indexing	Use parent-relative counters
XML XPath: Toggle Ignore Parent Segment	Remove parent tag from relative XPath
🪄 Pro Tip: All commands are prefixed with XML XPath: — just type that in the command palette!

🛠️ Configuration Settings
Basic Settings
jsonc
{
  // Parent tag for relative XPath generation
  "xmlXpath.parentTag": "section",
  
  // XPath generation mode
  "xmlXpath.mode": {
    "includeIndices": true,
    "includeAttributes": true
  },
  
  // Preferred attributes for predicates (order matters!)
  "xmlXpath.preferredAttributes": ["id", "name", "type"],
  
  // Custom predicate template
  "xmlXpath.predicateTemplate": "[@{attr1}='{attr1V}']"
}
Index Control
jsonc
{
  // Skip [1] for unique elements
  "xmlXpath.skipSingleIndex": true,
  
  // Never show [1] for these tags
  "xmlXpath.ignoreIndexTags": ["html", "body"],
  
  // Always show [1] for these tags (when skipSingleIndex is false)
  "xmlXpath.forceIndexOneFor": ["section", "paragraph"],
  
  // Exception tags that never show [1] (overrides everything)
  "xmlXpath.exceptionsToIndexOneForcing": ["subsection"],
  
  // Disable index on the last element
  "xmlXpath.disableLeafIndex": false
}
Advanced Features
jsonc
{
  // Use xlink:label for indexing
  "xmlXpath.useXlinkLabelIndex": false,
  
  // Pattern for extracting numbers from xlink:label
  "xmlXpath.xlinkLabelPattern": {
    "type": "any",  // "any", "startsWith", "contains", "endsWith", "regex", "exactPrefix"
    "pattern": ""
  },
  
  // Use parent-scoped index counters
  "xmlXpath.useParentScopedIndices": false,
  
  // Enable attribute-based indexing
  "xmlXpath.useAttributeBasedIndexing": false,
  
  // Remove parent segment from relative XPath
  "xmlXpath.ignoreParentSegment": false
}
📚 Examples
Basic XPath Generation
xml
<root>
  <section id="main">
    <paragraph>Text</paragraph>
  </section>
</root>
Result: /root/section[@id='main']/paragraph

Attribute-Based Indexing
xml
<Properties>
  <Property ValuationType="SUBJECT" id="1"/>
  <Property ValuationType="COMPARABLE" id="2"/>
  <Property ValuationType="COMPARABLE" id="3"/>
</Properties>
With attribute-based indexing ON:

/Properties/Property[@ValuationType='SUBJECT'][@id='1'][1]
/Properties/Property[@ValuationType='COMPARABLE'][@id='2'][1]
/Properties/Property[@ValuationType='COMPARABLE'][@id='3'][2]
Custom Predicate Templates
Available tokens:

{attr1} - Attribute name
{attr1V} - Attribute value
{tag} - Element tag name
{idx} - Element index
{at} - @ symbol
{xllv} - xlink:label raw value
{xllvI} - xlink:label index
Example templates:

Default: [@{attr1}='{attr1V}']
Contains: [contains(@{attr1}, '{attr1V}')]
Multiple: [@{attr1}='{attr1V}'][position()={idx}]
🎯 Use Cases
Web Scraping - Generate reliable XPaths for data extraction
Test Automation - Create stable selectors for UI tests
XML Processing - Navigate complex XML structures
Documentation - Reference specific elements in XML docs
🤝 Contributing
Found a bug or have a feature request? Please open an issue on GitHub.

📝 License
This extension is licensed under the MIT License.

Enjoy generating XPaths! 🚀