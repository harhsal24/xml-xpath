const fs = require("fs");
const path = require("path");
const XPathBuilder = require("../XPathBuilder");

const testCases = [
  // Basic Element Tests
  {
    description: "Test 1.1: Basic element with index",
    cursor: { line: 7, character: 25 }, // John Doe
    config: { mode: { includeIndices: true, includeAttributes: false } },
    expectedXPath: "/CompanyData[1]/Employees[1]/Employee[1]/Name[1]",
  },
  {
    description: "Test 1.2: Element with ID attribute",
    cursor: { line: 11, character: 25 }, // Jane Smith
    config: {
      preferredAttributes: ["id"],
      mode: { includeIndices: false, includeAttributes: true },
    },
    expectedXPath: "/CompanyData/Employees/Employee[@id='emp002']/Name",
  },
  {
    description: "Test 1.3: Skip single index [1]",
    cursor: { line: 7, character: 25 }, // John Doe
    config: {
      skipSingleIndex: true,
      mode: { includeIndices: true, includeAttributes: false },
    },
    expectedXPath: "/CompanyData/Employees/Employee/Name",
  },

  // Deeply Nested Tests
  {
    description: "Test 2.1: Deeply nested same-name elements",
    cursor: { line: 25, character: 30 }, // Frontend Team
    config: { mode: { includeIndices: true, includeAttributes: false } },
    expectedXPath:
      "/CompanyData[1]/Organization[1]/Division[1]/Division[1]/Division[1]/Team[1]",
  },
  {
    description: "Test 2.2: Parent-scoped indexing for nested elements",
    cursor: { line: 30, character: 30 }, // Android Team
    config: {
      useParentScopedIndices: true,
      mode: { includeIndices: true, includeAttributes: false },
    },
    expectedXPath:
      "/CompanyData[1]/Organization[1]/Division[1]/Division[1]/Division[2]/Team[2]",
  },

  // Namespace Tests
  {
    description: "Test 3.1: Namespaced element",
    cursor: { line: 45, character: 35 }, // Alice Cooper
    config: { mode: { includeIndices: true, includeAttributes: false } },
    expectedXPath:
      "/CompanyData[1]/Departments[1]/dept:Engineering[1]/dept:Manager[1]",
  },
  {
    description: "Test 3.2: Namespaced with attribute",
    cursor: { line: 46, character: 55 }, // Budget 1000000
    config: {
      preferredAttributes: ["currency"],
      mode: { includeIndices: false, includeAttributes: true },
    },
    expectedXPath:
      "/CompanyData/Departments/dept:Engineering/dept:Budget[@currency='USD']",
  },

  // xlink:label Tests
  {
    description: "Test 4.1: xlink:label indexing (project_205)",
    cursor: { line: 61, character: 25 }, // Mobile App
    config: {
      useXlinkLabelIndex: true,
      mode: { includeIndices: true, includeAttributes: false },
    },
    expectedXPath: "/CompanyData[1]/Projects[1]/Project[205]/Name[1]",
  },
  {
    description: "Test 4.2: xlink:lable typo handling (project_303)",
    cursor: { line: 65, character: 25 }, // Data Pipeline
    config: {
      useXlinkLabelIndex: true,
      mode: { includeIndices: true, includeAttributes: false },
    },
    expectedXPath: "/CompanyData[1]/Projects[1]/Project[303]/Name[1]",
  },
  {
    description: "Test 4.3: No xlink:label fallback",
    cursor: { line: 69, character: 25 }, // Legacy System
    config: {
      useXlinkLabelIndex: true,
      mode: { includeIndices: true, includeAttributes: false },
    },
    expectedXPath: "/CompanyData[1]/Projects[1]/Project[4]/Name[1]",
  },

  // Parent-Scoped vs Global Indexing
  {
    description: "Test 5.1: Global indexing for Section elements",
    cursor: { line: 85, character: 30 }, // Q1 Report -> Financials
    config: {
      useParentScopedIndices: false,
      mode: { includeIndices: true, includeAttributes: false },
    },
    expectedXPath: "/CompanyData[1]/Reports[1]/Report[2]/Section[4]",
  },
  {
    description: "Test 5.2: Parent-scoped indexing for Section elements",
    cursor: { line: 85, character: 30 }, // Q1 Report -> Financials
    config: {
      useParentScopedIndices: true,
      mode: { includeIndices: true, includeAttributes: false },
    },
    expectedXPath: "/CompanyData[1]/Reports[1]/Report[2]/Section[2]",
  },

  // CDATA Tests
  {
    description: "Test 6: Element containing CDATA",
    cursor: { line: 97, character: 40 }, // Inside CDATA function
    config: { mode: { includeIndices: true, includeAttributes: false } },
    expectedXPath: "/CompanyData[1]/Documentation[1]/CodeSample[1]",
  },

  // Self-Closing and Empty Elements
  {
    description: "Test 7.1: Self-closing element with attributes",
    cursor: { line: 113, character: 35 }, // Setting debug="true"
    config: {
      preferredAttributes: ["name"],
      mode: { includeIndices: false, includeAttributes: true },
    },
    expectedXPath: "/CompanyData/Configuration/Setting[@name='debug']",
  },
  {
    description: "Test 7.2: Empty element",
    cursor: { line: 115, character: 20 }, // EmptyConfig
    config: { mode: { includeIndices: true, includeAttributes: false } },
    expectedXPath: "/CompanyData[1]/Configuration[1]/EmptyConfig[1]",
  },

  // Mixed Content Tests
  {
    description: "Test 8.1: Inline element in mixed content",
    cursor: { line: 122, character: 35 }, // <strong>new</strong>
    config: { mode: { includeIndices: true, includeAttributes: false } },
    expectedXPath:
      "/CompanyData[1]/Announcements[1]/Announcement[1]/Text[1]/strong[1]",
  },
  {
    description: "Test 8.2: Anchor in mixed content",
    cursor: { line: 126, character: 35 }, // <a href="/docs">
    config: { mode: { includeIndices: true, includeAttributes: false } },
    expectedXPath:
      "/CompanyData[1]/Announcements[1]/Announcement[2]/Text[1]/a[1]",
  },

  // Complex Attribute Tests
  {
    description: "Test 9.1: Multiple attributes with preferred order",
    cursor: { line: 134, character: 25 }, // Laptop Pro
    config: {
      preferredAttributes: ["sku", "category"],
      mode: { includeIndices: false, includeAttributes: true },
    },
    expectedXPath: "/CompanyData/Products/Product[@sku='PROD-001']/Name",
  },
  {
    description: "Test 9.2: Price with currency attribute",
    cursor: { line: 143, character: 35 }, // 450.00
    config: {
      preferredAttributes: ["currency"],
      mode: { includeIndices: false, includeAttributes: true },
    },
    expectedXPath: "/CompanyData/Products/Product/Price[@currency='EUR']",
  },

  // Parent Tag Tests
  {
    description: "Test 10.1: Relative XPath from parent",
    cursor: { line: 25, character: 30 }, // Frontend Team
    config: {
      parentTag: "Division",
      mode: { includeIndices: true, includeAttributes: false },
    },
    expectedXPath: "/Division[1]/Division[1]/Division[1]/Team[1]",
  },
  {
    description: "Test 10.2: Relative XPath with ignoreParentSegment",
    cursor: { line: 25, character: 30 }, // Frontend Team
    config: {
      parentTag: "Organization",
      ignoreParentSegment: true,
      mode: { includeIndices: true, includeAttributes: false },
    },
    expectedXPath: "/Division[1]/Division[1]/Division[1]/Team[1]",
  },

  // Disable Leaf Index Tests
  {
    description: "Test 11.1: Disable leaf index",
    cursor: { line: 7, character: 25 }, // John Doe
    config: {
      disableLeafIndex: true,
      mode: { includeIndices: true, includeAttributes: false },
    },
    expectedXPath: "/CompanyData[1]/Employees[1]/Employee[1]/Name",
  },
  {
    description: "Test 11.2: Disable leaf index with attributes",
    cursor: { line: 134, character: 25 }, // Laptop Pro
    config: {
      disableLeafIndex: true,
      preferredAttributes: ["sku"],
      mode: { includeIndices: true, includeAttributes: true },
    },
    expectedXPath: "/CompanyData[1]/Products[1]/Product[@sku='PROD-001'][1]/Name",
  },

  // Ignore Index Tags Tests
  {
    description: "Test 12.1: Ignore index for specific tags",
    cursor: { line: 25, character: 30 }, // Frontend Team
    config: {
      ignoreIndexTags: ["Division", "Team"],
      mode: { includeIndices: true, includeAttributes: false },
    },
    expectedXPath:
      "/CompanyData[1]/Organization[1]/Division/Division/Division/Team",
  },
  {
    description: "Test 12.2: Ignore index only affects [1]",
    cursor: { line: 30, character: 30 }, // Android Team (2nd team)
    config: {
      ignoreIndexTags: ["Team"],
      mode: { includeIndices: true, includeAttributes: false },
    },
    expectedXPath:
      "/CompanyData[1]/Organization[1]/Division[1]/Division[1]/Division[2]/Team[2]",
  },

  // Combined Configuration Tests
  {
    description: "Test 13.1: Multiple configs combined",
    cursor: { line: 85, character: 30 }, // Financials Section
    config: {
      parentTag: "Reports",
      useParentScopedIndices: true,
      disableLeafIndex: true,
      preferredAttributes: ["type"],
      mode: { includeIndices: true, includeAttributes: true },
    },
    expectedXPath: "/Reports[1]/Report[@type='quarterly'][2]/Section",
  },
  {
    description: "Test 13.2: Skip single with parent scope",
    cursor: { line: 122, character: 35 }, // <strong>new</strong>
    config: {
      skipSingleIndex: true,
      useParentScopedIndices: true,
      mode: { includeIndices: true, includeAttributes: false },
    },
    expectedXPath: "/CompanyData/Announcements/Announcement/Text/strong",
  },

  // Edge Cases
  {
    description: "Test 14.1: Root element selection",
    cursor: { line: 2, character: 15 }, // CompanyData
    config: { mode: { includeIndices: true, includeAttributes: false } },
    expectedXPath: "/CompanyData[1]",
  },
  {
    description: "Test 14.2: Attribute-only mode with no matching attributes",
    cursor: { line: 78, character: 25 }, // Section without attributes
    config: {
      preferredAttributes: ["id", "type"],
      mode: { includeIndices: false, includeAttributes: true },
    },
    expectedXPath: "/CompanyData/Reports/Report[@type='monthly']/Section",
  },
  {
    description: "Test 14.3: Simple mode (no indices, no attributes)",
    cursor: { line: 26, character: 30 }, // Frontend Team
    config: {
      mode: { includeIndices: false, includeAttributes: false },
    },
    expectedXPath: "/CompanyData/Organization/Division/Division/Division/Team",
  },
];

// Test Runner
const createMockDocument = (content) => {
  const lines = content.split("\n");
  return {
    getText: () => content,
    offsetAt: (position) => {
      let offset = 0;
      for (let i = 0; i < position.line; i++) {
        offset += lines[i].length + 1;
      }
      return offset + position.character;
    },
  };
};

async function runTests() {
  console.log("=== XPath Builder Test Suite ===\n");

  const xmlPath = path.join(__dirname, "test-file.xml");
  const xmlContent = fs.readFileSync(xmlPath, "utf-8");
  const mockDocument = createMockDocument(xmlContent);

  let passed = 0;
  let failed = 0;
  const failedTests = [];

  const xpathBuilder = new XPathBuilder();

  // Group tests by category
  const categories = {
    "Basic Elements": testCases.filter((t) =>
      t.description.startsWith("Test 1")
    ),
    "Nested Elements": testCases.filter((t) =>
      t.description.startsWith("Test 2")
    ),
    Namespaces: testCases.filter((t) => t.description.startsWith("Test 3")),
    "xlink:label": testCases.filter((t) => t.description.startsWith("Test 4")),
    "Indexing Modes": testCases.filter((t) =>
      t.description.startsWith("Test 5")
    ),
    CDATA: testCases.filter((t) => t.description.startsWith("Test 6")),
    "Self-Closing/Empty": testCases.filter((t) =>
      t.description.startsWith("Test 7")
    ),
    "Mixed Content": testCases.filter((t) =>
      t.description.startsWith("Test 8")
    ),
    Attributes: testCases.filter((t) => t.description.startsWith("Test 9")),
    "Parent Tag": testCases.filter((t) => t.description.startsWith("Test 10")),
    "Leaf Index": testCases.filter((t) => t.description.startsWith("Test 11")),
    "Ignore Tags": testCases.filter((t) => t.description.startsWith("Test 12")),
    Combined: testCases.filter((t) => t.description.startsWith("Test 13")),
    "Edge Cases": testCases.filter((t) => t.description.startsWith("Test 14")),
  };

  for (const [category, tests] of Object.entries(categories)) {
    console.log(`\n### ${category} ###`);

    for (const test of tests) {
      // Override loadConfiguration for each test
      xpathBuilder.loadConfiguration = () => {
        const baseConfig = {
          parentTag: null,
          mode: { includeIndices: true, includeAttributes: true },
          preferredAttributes: [],
          ignoreTags: new Set(test.config.ignoreIndexTags || []),
          disableLeafIndex: false,
          skipSingleIndex: false,
          useXlinkLabelIndex: false,
          useParentScopedIndices: true,
          ignoreParentSegment: false,
        };
        return { ...baseConfig, ...test.config };
      };

      const mockPosition = {
        line: test.cursor.line - 1,
        character: test.cursor.character - 1,
      };

      try {
        const actualXPath = xpathBuilder.buildXPathRegex(
          mockDocument,
          mockPosition
        );

        if (actualXPath === test.expectedXPath) {
          console.log(`  ✅ ${test.description}`);
          passed++;
        } else {
          console.log(`  ❌ ${test.description}`);
          console.log(`     Expected: ${test.expectedXPath}`);
          console.log(`     Actual:   ${actualXPath || "(null)"}`);
          failed++;
          failedTests.push(test.description);
        }
      } catch (error) {
        console.log(`  💥 ${test.description}`);
        console.log(`     Error: ${error.message}`);
        failed++;
        failedTests.push(test.description);
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("TEST SUMMARY");
  console.log("=".repeat(50));
  console.log(`Total Tests: ${passed + failed}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);

  if (failed > 0) {
    console.log("\nFailed Tests:");
    failedTests.forEach((test) => console.log(`  - ${test}`));
    process.exit(1);
  } else {
    console.log("\n🎉 All tests passed!");
  }
}

// Run the tests only when executed directly
if (require.main === module) {
  runTests().catch((error) => {
    console.error("Test runner error:", error);
    process.exit(1);
  });
}

module.exports = { testCases, runTests };
