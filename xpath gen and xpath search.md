# XML XPath Extension — Complete Reference
**Package:** `xml-xpath-extension` · **Version:** 3.5.6 · **Publisher:** HB24  
**Files:** `extension.js` · `XPathBuilder.js` · **Dependency:** `fast-xml-parser ^4.5.3`

---

## Project Overview

A VS Code extension that generates XPath expressions from your cursor position in any XML file and lets you search/navigate to elements using XPath queries. It supports absolute paths, relative paths, smart landmark-based paths, namespace handling, attribute-based indexing, and a live status bar preview.

**Supported file types:** `.xml` `.xsd` `.xsl` `.xaml` `.svg` `.xhtml` `.wsdl` and more.

---

## Architecture

```
extension.js  (VS Code layer)
│  ├── Status bar — live XPath preview
│  ├── Command handlers (copy, search, toggles, setters)
│  └── XPath search engine (parseXPath → searchForElement)
│
XPathBuilder.js  (Core engine)
│  ├── tokenizeXML()       — regex tokenizer
│  ├── buildElementStack() — walk events up to cursor offset
│  ├── processPath()       — apply parent tag / ignore segment
│  └── generateXPath()     — dispatch to output strategy
│       ├── absolute path
│       ├── generateRelativeXPath()
│       └── generateSmartRelativeXPath()
│           ├── generateMultiLineSmartXPath()
│           └── generateSingleLineSmartXPath()
```

---

## Part 1 — XPath Generation

### How It Works (Step by Step)

```
User moves cursor
       │
1. tokenizeXML()
   Strip comments, CDATA, <?xml?>, DOCTYPE (replace with spaces to preserve offsets)
   Regex walk → emit open / close / self-close / text events with byte positions
       │
2. buildElementStack()
   Walk events until event.pos > cursor offset
   For each open tag: compute index, collect preferred attrs, build namespace context, push stack
   For each close tag: pop stack
   Result: stack[] = ancestors up to cursor element
       │
3. processPath()
   If parentTag set → slice stack from that element
   If ignoreParentSegment → drop the parent element itself
       │
4. generateXPath()
   useSmartRelativePath → smart relative output
   useRelativePath      → basic relative output
   Default              → absolute output
       │
5. Render to status bar + copy on command
```

### Indexing Strategies

Three strategies compute `[n]` — must match between generation and search:

### Output Strategies

#### 1. Absolute Path (default)
```
/catalog[1]/products[1]/item[@id='laptop'][3]
```

#### 2. Basic Relative Path (`useRelativePath`)
```
//products[@type='electronics']//item[@id='laptop'][3]
```
Keeps: root + elements with significant attributes + target.  
Drops: elements without significant attrs.  

#### 3. Smart Relative Path (`useSmartRelativePath`)

Landmark-based — builds a minimal path through significant ancestors.

**Landmark selection rules:**
1. Always include: virtual root / start anchor
2. Always include: tags in `smartRelativeAlwaysIncludeTags`
3. Include if: element has a significant attribute (`smartRelativeSignificantAttributes`)
4. Include if: element has an identifying child (child element text that identifies parent)
5. Always include: the target element itself

**Multi-line output:**
```
/d:CATALOG
//d:VALUATION[@ValuationType='Market']
//d:PROPERTY[@id='P001']
    //d:VALUE[2]
```

**Single-line output (`smartRelativeSingleLine`):**
```
//d:VALUATION[@ValuationType='Market']//d:PROPERTY[@id='P001']//d:VALUE[2]
```

**Virtual root modes:**
- `include` → XPath starts with `//VirtualRoot`
- `exclude` → XPath starts from children of virtual root


### Namespace Handling

When `includeNamespaces: true`:
- Tags already prefixed → left as-is
- Tags with known namespace URI → prefix resolved from namespace map
- Tags in default namespace with `includeDefaultNamespaces` → `*[local-name()='tag']`

Namespace map built by scanning all `xmlns:prefix="uri"` declarations and propagating through element stack.

### Full Feature List

| # | Feature | Config Key |
|---|---|---|
| 1 | Copy XPath from cursor | `Ctrl+Shift+C` |
| 2 | Copy Universal XPath | command |
| 3 | Live status bar preview | auto |
| 4 | Smart relative paths | `useSmartRelativePath` |
| 5 | Basic relative paths | `useRelativePath` |
| 6 | Multi-line formatting | default in smart mode |
| 7 | Single-line formatting | `smartRelativeSingleLine` |
| 8 | Virtual root (include/exclude) | `smartRelativeVirtualRoot` |
| 9 | Parent tag scoping | `parentTag` / `ignoreParentSegment` |
| 10 | Attribute-based indexing | `useAttributeBasedIndexing` |
| 11 | Preferred attributes | `preferredAttributes` |
| 13 | Skip single `[1]` | `skipSingleIndex` |
| 14 | Force `[1]` for tags | `forceIndexOneFor` |
| 15 | Disable leaf index | `disableLeafIndex` |
| 16 | Parent-scoped indexing | `useParentScopedIndices` |
| 18 | Namespace support | `includeNamespaces` |
| 19 | Always-include tags | `smartRelativeAlwaysIncludeTags` |
| 20 | Don't-ignore-after anchor (smart) | `smartRelativeDontIgnoreAfter` |
| 22 | Identifying children | `smartRelativeIdentifyingChildren` |
| 24 | Ignore-index tags | `ignoreIndexTags` |
| 25 | XPath mode (both/attrs/indices/simple) | `mode` |
| 26 | Max parse size | `maxParseSize` |
| 27 | XPath search & navigate | `Ctrl+Shift+F` |

---

## Part 2 — XPath Search Engine

### How It Works (Step by Step)

```
User presses Ctrl+Shift+F
       │
1. Read clipboard → if starts with / or // → use directly
   Otherwise → show input box
       │
2. parseXPath(xpathString)
   Strip leading // or /
   Split by /
   For each segment: extract tagName + parse predicates[]
       │
3. tokenizeXML(documentText, config)
   Same tokenizer as generation → flat events[]
       │
4. searchForElement(events, segments, config)
   Walk events, maintain stack + counters (same 3 strategies as generation)
   At each open tag: compute index, push stack
   getMatchDepth(stack, segments) → how many segments match from root
   Track bestMatch (deepest partial match)
   On FULL MATCH → return immediately
       │
5. Translate offsets → VS Code positions
   editor.selection = Selection(startPos, endPos)
   editor.revealRange(..., InCenter)
   Show info / warning message
```

### XPath Parser — `parseXPath()`

**Input:** `/catalog/products[@type='electronics']/item[3]`

**Output:**
```javascript
[
  { tagName: "catalog",  predicates: [] },
  { tagName: "products", predicates: [
      { type: "attribute", name: "type", value: "electronics" }
  ]},
  { tagName: "item", predicates: [
      { type: "position", value: 3 }
  ]}
]
```

**Supported predicate types:**

| Syntax | Type |
|---|---|
| `[3]` | `position` |
| `[position()=3]` | `position` |
| `[last()]` | `last` |
| `[@id='val']` | `attribute` |
| `[contains(@class,'x')]` | `contains` |
| `[text()='Hello']` | `text` |
| anything else | `other` → conservative fail |

Multiple predicates per segment supported: `item[@type='book'][2]` → 2 predicates.

### Match Depth — `getMatchDepth()`

At each stack state, checks how many consecutive segments match from root:

```
stack = [catalog, products, item]  (item is the 3rd item of this type)
segs  = [catalog, products[@type='electronics'], item[3]]

i=0: "catalog" ✓  no predicates → depth=1
i=1: "products" ✓  @type='electronics' ✓ → depth=2
i=2: "item" ✓  index===3 ✓ → depth=3

depth=3 === segments.length → FULL MATCH → return immediately
```

If tag name doesn't match → break (no partial credit for that branch).  
If any predicate fails → break (all predicates must pass).

### Predicate Evaluation

```javascript
let actualIndex = stackItem.index;
if (actualIndex !== pred.value) → fail

// attribute
if (!stackItem.attrs || stackItem.attrs[pred.name] !== pred.value) → fail

// contains
if (!stackItem.attrs[pred.target]?.includes(pred.value)) → fail

// text() → conservatively fails (cannot scan forward safely in this context)
// other  → conservatively fails
```

### Full vs. Partial Match

| Result | Action | Message |
|---|---|---|
| Full match | Select + reveal element | ✅ `Found and selected <item> at line 42.` |
| Partial match | Select closest ancestor | ⚠️ `Partial match (2/3) — selected <section> at line 15.` |
| No match | Nothing | ❌ `XPath not found: /catalog/...` |

### End-Offset Calculation

After finding a match, scans forward to find the closing tag (handles nested same-name elements):

```javascript
let openCount = 1;
for (let j = matchEventIndex + 1; j < events.length; j++) {
    if (events[j].type === "open"  && events[j].tag === matchedTag) openCount++;
    if (events[j].type === "close" && events[j].tag === matchedTag) {
        openCount--;
        if (openCount === 0) { endOffset = events[j].pos; break; }
    }
}
```

### Generation ↔ Search Consistency

The search engine reuses the **same indexing algorithm** as the generator. If generated with `useParentScopedIndices: true`, search also uses parent-scoped counters.

```
Generate with config X  →  XPath string
Search   with config X  →  Same element ✓   (always works)

Generate with config X  →  XPath string
Search   with config Y  →  May fail         (different index numbers)
```

---

## Configuration Quick Reference

```jsonc
{
  "xmlXpath.mode": { "includeIndices": true, "includeAttributes": true },
  "xmlXpath.preferredAttributes": ["id", "type", "name"],
  "xmlXpath.parentTag": null,
  "xmlXpath.ignoreParentSegment": false,
  "xmlXpath.maxParseSize": 1000000,
  "xmlXpath.skipSingleIndex": false,
  "xmlXpath.disableLeafIndex": false,
  "xmlXpath.forceIndexOneFor": [],
  "xmlXpath.exceptionsToIndexOneForcing": [],
  "xmlXpath.ignoreIndexTags": [],
  "xmlXpath.useParentScopedIndices": true,
  "xmlXpath.useAttributeBasedIndexing": false,
  "xmlXpath.attributeBasedIndexingAttribute": "",
  "xmlXpath.useRelativePath": false,
  "xmlXpath.useSmartRelativePath": false,
  "xmlXpath.smartRelativeNamespacePrefix": "d",
  "xmlXpath.smartRelativeSignificantAttributes": [],
  "xmlXpath.smartRelativeIdentifyingChildren": [],
  "xmlXpath.smartRelativeAlwaysIncludeTags": [],
  "xmlXpath.smartRelativeDontIgnoreAfter": "",
  "xmlXpath.smartRelativeLandmarkMode": true,
  "xmlXpath.smartRelativeSingleLine": false,
  "xmlXpath.smartRelativeIgnoreLastElement": false,
  "xmlXpath.smartRelativeVirtualRoot": "",
  "xmlXpath.smartRelativeVirtualRootMode": "include",
  "xmlXpath.includeNamespaces": false,
  "xmlXpath.includeDefaultNamespaces": false
}
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+C` | Copy XPath from cursor |
| `Ctrl+Shift+F` / `Alt+Shift+X` | Search with XPath |
| `Ctrl+Shift+X` | Toggle smart relative path |
