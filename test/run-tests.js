// ========== File: run-tests.js (Recommended Update) ==========

const fs = require('fs');
const path = require('path');
const XPathBuilder = require('../XPathBuilder');

const testCases = [
    {
        description: 'Test 1: Basic Sibling Indexing',
        cursor: { line: 7, character: 48 }, // Chicago
        config: { useParentScopedIndices: false, mode: { includeIndices: true } },
        expectedXPath: '/MegaStoreInventory[1]/StoreLocations[1]/Location[3]'
    },
    {
        description: 'Test 2: Deeply Nested Same-Name Tag',
        cursor: { line: 15, character: 30 }, // Laptops
        config: { useParentScopedIndices: false, mode: { includeIndices: true } },
        expectedXPath: '/MegaStoreInventory[1]/ProductCategories[1]/Category[1]/Category[1]/Category[1]'
    },
    {
        description: 'Test 3: Namespaced Element',
        cursor: { line: 31, character: 20 }, // promo:Code
        config: { useParentScopedIndices: false, mode: { includeIndices: true } },
        expectedXPath: '/MegaStoreInventory[1]/Promotions[1]/promo:HolidaySale[1]/promo:Code[1]'
    },
    {
        description: 'Test 4: Attribute Predicate (id)',
        cursor: { line: 5, character: 15 }, // Location id="loc-nyc"
        config: { preferredAttributes: ['id'], mode: { includeAttributes: true, includeIndices: false }, skipSingleIndex: true },
        expectedXPath: "/MegaStoreInventory/StoreLocations/Location[@id='loc-nyc']"
    },
    {
        description: 'Test 5.1: CRITICAL - Parent-Scoped Indexing',
        cursor: { line: 68, character: 45 }, // Second Feedback's Comment
        config: { useParentScopedIndices: true, mode: { includeIndices: true } },
        expectedXPath: '/MegaStoreInventory[1]/CustomerFeedback[1]/Feedback[2]/Comment[1]'
    },
    {
        description: 'Test 5.2: CRITICAL - Global Indexing',
        cursor: { line: 68, character: 45 }, // Second Feedback's Comment
        config: { useParentScopedIndices: false, mode: { includeIndices: true } },
        expectedXPath: '/MegaStoreInventory[1]/CustomerFeedback[1]/Feedback[2]/Comment[3]'
    },
    {
        description: 'Test 6: Inside CDATA Section',
        cursor: { line: 77, character: 30 }, // Inside function
        config: { mode: { includeIndices: true } },
        expectedXPath: '/MegaStoreInventory[1]/InternalNotes[1]/Note[1]/code[1]'
    },
    {
        description: 'Test 7: Mixed Content Inner Element',
        cursor: { line: 89, character: 28 }, // <b>new</b>
        config: { mode: { includeIndices: true } },
        expectedXPath: '/MegaStoreInventory[1]/ProductDetails[1]/Detail[1]/Description[1]/b[1]'
    },
    {
        description: 'Test 8: xlink:label Indexing',
        cursor: { line: 49, character: 15 }, // Order xlink:label="order_B789"
        config: { useXlinkLabelIndex: true, mode: { includeIndices: true } },
        expectedXPath: '/MegaStoreInventory[1]/OnlineOrders[1]/Order[789]'
    },
];

// --- Test Runner Logic ---
const createMockDocument = (content) => {
    const lines = content.split('\n');
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
    console.log('--- Running XPath Builder Tests ---\n');
    const xmlPath = path.join(__dirname, 'test-suite.xml');
    const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
    const mockDocument = createMockDocument(xmlContent);

    let passed = 0, failed = 0;
    const xpathBuilder = new XPathBuilder();
    
    for (const test of testCases) {
        xpathBuilder.loadConfiguration = () => {
            const baseConfig = { mode: { includeIndices: true, includeAttributes: true }, ignoreTags: new Set() };
            return { ...baseConfig, ...test.config };
        };

        const mockPosition = { line: test.cursor.line - 1, character: test.cursor.character - 1 };
        const actualXPath = xpathBuilder.buildXPathRegex(mockDocument, mockPosition);

        if (actualXPath === test.expectedXPath) {
            console.log(`\x1b[32m✔ PASS:\x1b[0m ${test.description}`);
            passed++;
        } else {
            console.log(`\x1b[31m✖ FAIL:\x1b[0m ${test.description}`);
            console.log(`  \x1b[33mExpected:\x1b[0m ${test.expectedXPath}`);
            console.log(`  \x1b[31mActual:  \x1b[0m ${actualXPath}`);
            failed++;
        }
        console.log('---');
    }

    console.log(`\n--- Test Summary ---\n\x1b[32mPassed: ${passed}\x1b[0m, \x1b[31mFailed: ${failed}\x1b[0m\n--------------------\n`);
    if (failed > 0) process.exit(1);
}

runTests();