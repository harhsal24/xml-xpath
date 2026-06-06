// ========== File: lib/configManager.js ==========

const CONFIG_SECTION = "xmlXpath";

/**
 * Returns default options for XPath generation and parsing.
 * @returns {object} Default configuration options.
 */
function getDefaultConfiguration() {
  return {
    parentTag: null,
    mode: { includeIndices: true, includeAttributes: true },
    preferredAttributes: [],
    ignoreTags: new Set(),
    disableLeafIndex: false,
    skipSingleIndex: false,
    useParentScopedIndices: true,
    ignoreParentSegment: false,
    forceIndexOneFor: new Set(),
    exceptionsToIndexOneForcing: new Set(),
    useAttributeBasedIndexing: false,
    attributeBasedIndexingAttribute: "",
    useRelativePath: false,
    includeNamespaces: false,
    includeDefaultNamespaces: false,
    defaultNamespacePrefix: "d",
  };
}

/**
 * Loads configuration from VS Code workspace.
 * @param {object} vscode VS Code API reference.
 * @returns {object} Loaded configuration options.
 */
function loadVSCodeConfiguration(vscode) {
  if (!vscode) {
    return getDefaultConfiguration();
  }
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

  return {
    parentTag: cfg.get("parentTag", null),
    mode: cfg.get("mode", { includeIndices: true, includeAttributes: true }),
    preferredAttributes: cfg.get("preferredAttributes", []),
    ignoreTags: new Set(cfg.get("ignoreIndexTags", [])),
    disableLeafIndex: cfg.get("disableLeafIndex", false),
    skipSingleIndex: cfg.get("skipSingleIndex", false),
    useParentScopedIndices: cfg.get("useParentScopedIndices", true),
    ignoreParentSegment: cfg.get("ignoreParentSegment", false),
    forceIndexOneFor: new Set(cfg.get("forceIndexOneFor", [])),
    exceptionsToIndexOneForcing: new Set(cfg.get("exceptionsToIndexOneForcing", [])),
    useAttributeBasedIndexing: cfg.get("useAttributeBasedIndexing", false),
    attributeBasedIndexingAttribute: cfg.get("attributeBasedIndexingAttribute", ""),
    useRelativePath: cfg.get("useRelativePath", false),
    includeNamespaces: cfg.get("includeNamespaces", false),
    includeDefaultNamespaces: cfg.get("includeDefaultNamespaces", false),
    defaultNamespacePrefix: cfg.get("defaultNamespacePrefix", "d"),
  };
}

module.exports = {
  CONFIG_SECTION,
  getDefaultConfiguration,
  loadVSCodeConfiguration,
};
