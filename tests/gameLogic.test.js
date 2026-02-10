const assert = require('assert');
const { checkWinner } = require('../src/utils/gameLogic');

console.log('🧪 Testing gameLogic.js...');

const testCases = [
    {
        name: 'Horizontal 5 in a row',
        board: [
            { row: 0, col: 0, player: 'black' },
            { row: 0, col: 1, player: 'black' },
            { row: 0, col: 2, player: 'black' },
            { row: 0, col: 3, player: 'black' },
            { row: 0, col: 4, player: 'black' }
        ],
        lastMove: { row: 0, col: 4, player: 'black' },
        expected: 'black'
    },
    {
        name: 'Horizontal 4 in a row (No win)',
        board: [
            { row: 0, col: 0, player: 'black' },
            { row: 0, col: 1, player: 'black' },
            { row: 0, col: 2, player: 'black' },
            { row: 0, col: 3, player: 'black' }
        ],
        lastMove: { row: 0, col: 3, player: 'black' },
        expected: null
    },
    {
        name: 'Horizontal 6 in a row (No win - Strict 5)',
        board: [
            { row: 0, col: 0, player: 'black' },
            { row: 0, col: 1, player: 'black' },
            { row: 0, col: 2, player: 'black' },
            { row: 0, col: 3, player: 'black' },
            { row: 0, col: 4, player: 'black' },
            { row: 0, col: 5, player: 'black' }
        ],
        lastMove: { row: 0, col: 5, player: 'black' },
        expected: null
    },
    {
        name: 'Vertical 5 in a row',
        board: [
            { row: 0, col: 0, player: 'white' },
            { row: 1, col: 0, player: 'white' },
            { row: 2, col: 0, player: 'white' },
            { row: 3, col: 0, player: 'white' },
            { row: 4, col: 0, player: 'white' }
        ],
        lastMove: { row: 4, col: 0, player: 'white' },
        expected: 'white'
    },
    {
        name: 'Diagonal 5 in a row',
        board: [
            { row: 0, col: 0, player: 'black' },
            { row: 1, col: 1, player: 'black' },
            { row: 2, col: 2, player: 'black' },
            { row: 3, col: 3, player: 'black' },
            { row: 4, col: 4, player: 'black' }
        ],
        lastMove: { row: 4, col: 4, player: 'black' },
        expected: 'black'
    }
];

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
    try {
        const result = checkWinner(test.board, test.lastMove);
        assert.strictEqual(result, test.expected);
        console.log(`✅ Test ${index + 1}: ${test.name} passed`);
        passed++;
    } catch (err) {
        console.error(`❌ Test ${index + 1}: ${test.name} failed`);
        console.error(`   Expected: ${test.expected}, Got: ${result}`);
        failed++;
    }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
