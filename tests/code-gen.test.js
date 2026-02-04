const assert = require('assert');

console.log('🧪 Lancement du test unitaire : Génération de Code');

// Simulation de la fonction utilisée dans le contrôleur
function generateResetCode() {
   return Math.floor(100000 + Math.random() * 900000).toString();
}

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`✅ ${description}`);
        passed++;
    } catch (error) {
        console.error(`❌ ${description}`);
        console.error(`   Erreur: ${error.message}`);
        failed++;
    }
}

// Tests
test('Le code doit être une chaîne de caractères', () => {
    const code = generateResetCode();
    assert.strictEqual(typeof code, 'string');
});

test('Le code doit avoir une longueur de 6 caractères', () => {
    const code = generateResetCode();
    assert.strictEqual(code.length, 6);
});

test('Le code doit contenir uniquement des chiffres', () => {
    const code = generateResetCode();
    assert.match(code, /^\d+$/);
});

test('Le code ne doit pas commencer par 0 (grâce à la formule Math.floor)', () => {
    // On teste 1000 fois pour être sûr statistiquement
    for (let i = 0; i < 1000; i++) {
        const code = generateResetCode();
        if (code.startsWith('0')) {
            throw new Error(`Le code commence par 0 : ${code}`);
        }
    }
});

console.log(`\n📊 Résultat : ${passed} succès, ${failed} échecs`);

if (failed > 0) process.exit(1);
