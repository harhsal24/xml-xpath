# XML XPath Extension

A lightweight Visual Studio Code extension that generates precise XPath expressions for XML elements under your cursor. With flexible configuration and real-time status updates, it streamlines XML navigation, testing, and automation.

## Key Features

- **Flexible Path Modes**: Choose between four generation modes:
  - **With Indices & Attributes**: Full precision including sibling indices (`[n]`) and attribute predicates (`[@id='value']`).
  - **Attributes Only**: Predicate filters based on attributes, but omit positional indices.
  - **Indices Only**: Rely solely on the element’s position among siblings, useful for static XML structures.
  - **Simple Path**: A clean, slash-separated element path without any predicates or indices.

- **Preferred Attribute Selection**: Define a prioritized list (e.g. `id, name, class`) so the extension picks the most meaningful attribute for each element predicate.

- **Ignore Default Index**: Suppress the “`[1]`” suffix for first-occurrence elements on your chosen tags (e.g. omit `[1]` for container elements like `section` or `div`).

- **Relative XPath Generation**: Set a custom **parent tag** so the returned path starts from that ancestor, producing shorter, context-aware XPaths.

- **Real-Time Status Bar Updates**: View the current XPath at all times as you move the cursor through your XML document.

## Installation

1. Clone or download this repository.
2. In VS Code, press `F5` to launch the extension in a new Extension Development Host window.
3. Alternatively, install from the VS Code Marketplace (coming soon).

## Usage Guide

### 1. Configure Your Preferences
- **Set XPath Mode**: Open the Command Palette (`Ctrl+Shift+P`), type `Set XPath Mode`, and choose your preferred generation style.
- **Set Preferred Attributes**: Run `Set Preferred Attributes` and enter a comma-separated list (e.g. `id, name, class`) in order of priority.
- **Set Ignore-Index Tags**: Run `Set Ignore-Index Tags` to list tags for which the default index `[1]` should not appear (e.g. `root, section`).
- **Set Parent Tag** (optional): Run `Set Parent Tag for XPath` and provide an ancestor tag name; XPaths will begin from this tag.

### 2. Copy the XPath
- Place your cursor inside any XML element.
- Press **Ctrl+Shift+C** (or run `Copy XPath from Cursor` from the Command Palette).
- The generated XPath is automatically copied to your clipboard.

### 3. Real-Time Feedback
- As you move the cursor, the status bar displays the current XPath using your active configuration.
- Click the status bar text to copy at any point without opening the command palette.

## Example

### Simple Example

```xml
<document>
  <section name="intro">
    <item id="first"/>
    <item id="second"/>
  </section>
</document>
```

- **With Indices & Attributes**:  
  `/document/section[@name='intro']/item[@id='second'][2]`
- **Attributes Only**:  
  `/document/section[@name='intro']/item[@id='second']`
- **Indices Only**:  
  `/document/section[1]/item[2]`
- **Simple Path**:  
  `/document/section/item`

### Nested Sections with xlink:lable and Ignore-Index

Given:
```xml
<document>
  <section xlink:lable='first1' name="intro">
    <item id="first"/>
    <item id="second"/>
    <container>
      <item id="nestedA"/>
      <item id="nestedB"/>
    </container>
  </section>
  <section xlink:lable='second2' name="intro">
    <item id="fourth"/>
    <item id="fifth"/>
    <container>
      <item id="nestedC"/>
      <item id="nestedD"/>
    </container>
  </section>
</document>
```

With settings:
- **Mode**: With Indices & Attributes  
- **Preferred Attributes**: `name, id`  
- **Ignore-Index Tags**: `section, container`

Cursor inside `<item id="nestedD"/>`, the extension yields:

```
/document/section[@name='intro'][2]/container/item[@id='nestedD'][2]
```

This path:  
- Skips `[1]` on both `section` and `container` (ignore-index)  
- Uses `[@name='intro']` on the second `section`  
- Includes `[2]` on the target `item` based on its sibling position  

## Under the Hood

1. **Tokenization**: Scans the entire XML text to record each opening and closing tag with its position.
2. **Stack-Based Path Building**: Maintains a `pathStack` of currently open elements, pushing on opening tags and popping on closing tags.
3. **Sibling Index Counting**: Uses `tagDepthCounters`—a per-depth counter map—to assign accurate `[n]` indices for elements as they appear.
4. **Attribute Parsing**: Extracts all attributes, applies custom index detection (`xlink:lable`), then selects the highest-priority attribute for predicates.
5. **Options Application**: Merges user settings (`includeIndices`, `includeAttributes`, `ignoreIndexTags`, `preferredAttrs`, and optional `parentTag`) to format the final XPath.

## Troubleshooting

- **Missing or incorrect index**: Ensure you’ve reloaded the extension after changing mode or ignore-tag settings. Check the status bar to confirm active configuration.
- **Extension activation errors**: Verify your `package.json` includes all new commands (`setIgnoreIndexTags`) in `activationEvents` and `contributes.commands`.
- **Nested sibling issues**: This extension uses a robust stack-based approach, but very large XML files might impact performance. Try splitting or simplifying if needed.

