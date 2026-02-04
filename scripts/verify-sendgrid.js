const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const sgMail = require('@sendgrid/mail');

async function verifySendGrid() {
  console.log('--- DIAGNOSTIC SENDGRID ---');

  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.error('❌ ERREUR: SENDGRID_API_KEY manquante dans .env');
    return;
  }
  
  // Mask key for log
  console.log(`✅ Clé API trouvée: ${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 5)}`);

  sgMail.setApiKey(apiKey);

  const fromEmail = process.env.EMAIL_FROM || 'deadpions@gmail.com';
  console.log(`📧 Tentative d'envoi depuis: ${fromEmail}`);
  console.log(`📧 Vers: ${fromEmail} (Test boucle locale)`);

  const msg = {
    to: fromEmail,
    from: fromEmail,
    subject: 'Test de Configuration SendGrid - DeadPions',
    text: 'Si vous lisez ceci, votre configuration SendGrid fonctionne correctement !',
    html: '<strong>Si vous lisez ceci, votre configuration SendGrid fonctionne correctement !</strong>',
  };

  try {
    await sgMail.send(msg);
    console.log('✅ SUCCÈS: Email envoyé avec succès !');
    console.log('👉 Vérifiez votre boîte de réception (et spam).');
  } catch (error) {
    console.error('❌ ÉCHEC ENVOI:');
    console.error(error.toString());
    if (error.response) {
      console.error('Détails SendGrid:', JSON.stringify(error.response.body, null, 2));
    }
    
    if (error.code === 403) {
      console.error('\n⚠️  ASTUCE: Erreur 403 signifie souvent que l\'expéditeur (Sender Identity) n\'est pas vérifié.');
      console.error(`   Allez sur https://app.sendgrid.com/settings/sender_auth et vérifiez que "${fromEmail}" est autorisé.`);
    }
  }
}

verifySendGrid();
