const path = require('path');
const dotenvPath = path.resolve(__dirname, '../.env');
require('dotenv').config({ path: dotenvPath });
const nodemailer = require('nodemailer');

console.log('--- Diagnostic Configuration Email ---');
console.log('Chemin .env:', dotenvPath);
console.log('EMAIL_USER:', process.env.EMAIL_USER);

async function verifyEmailConfig() {
    const pass = process.env.EMAIL_PASSWORD || '';
    console.log('EMAIL_PASSWORD:', pass ? `${pass.substring(0, 3)}...${pass.substring(pass.length - 3)}` : 'NON DÉFINI');

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
        console.error('ERREUR: EMAIL_USER ou EMAIL_PASSWORD manquant dans .env');
        return;
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER.trim(),
            pass: process.env.EMAIL_PASSWORD.trim()
        }
    });

    try {
        console.log('Tentative de connexion SMTP...');
        await transporter.verify();
        console.log('SUCCÈS: Connexion SMTP réussie ! Les identifiants sont valides.');
        
        console.log('Tentative d\'envoi d\'un email de test...');
        const info = await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // S'envoyer à soi-même pour tester
            subject: 'Test Diagnostic DeadPions',
            text: 'Si vous recevez ceci, la configuration email fonctionne.'
        });
        console.log('SUCCÈS: Email envoyé ! MessageID:', info.messageId);
    } catch (error) {
        console.error('ÉCHEC: Erreur lors du test SMTP:', error);
        if (error.code === 'EAUTH') {
            console.log('\nCONSEIL: Vérifiez que le mot de passe d\'application est correct et que le 2FA est activé sur le compte Google.');
        }
    }
}

verifyEmailConfig().catch(err => console.error('Erreur fatale:', err));
