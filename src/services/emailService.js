const sgMail = require('@sendgrid/mail');
require('dotenv').config();

// Configuration de l'API Key
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn('[EMAIL WARNING] Aucune clé API SendGrid trouvée (SENDGRID_API_KEY).');
}

exports.sendPasswordReset = async (email, resetCode, pseudo) => {
  if (!process.env.SENDGRID_API_KEY) {
    console.error('[EMAIL ERROR] Impossible d\'envoyer l\'email : Clé API SendGrid manquante.');
    console.log('CODE DE SECOURS (Log console):', resetCode);
    return;
  }

  const msg = {
    to: email,
    from: process.env.EMAIL_FROM || 'deadpions@gmail.com', // Doit être un expéditeur vérifié sur SendGrid
    subject: 'Votre code de réinitialisation - DeadPions',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #041c55;">Bonjour ${pseudo},</h2>
        <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
        <p>Voici votre code de vérification :</p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="background-color: #f1c40f; color: #000; padding: 15px 30px; 
                       font-size: 24px; letter-spacing: 5px; border-radius: 5px; font-weight: bold;">
            ${resetCode}
          </span>
        </div>
        <p style="color: #666; font-size: 14px;">
          ⏰ Ce code expire dans <strong>15 minutes</strong>.
        </p>
        <p style="color: #666; font-size: 14px;">
          Si vous n'avez pas demandé cette réinitialisation, ignorez cet email. 
          Votre mot de passe reste inchangé.
        </p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px;">
          Pour des raisons de sécurité, ne partagez jamais ce code.
        </p>
      </div>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`[EMAIL] Email SendGrid envoyé à ${email}`);
  } catch (error) {
    console.error('[EMAIL ERROR] Échec envoi SendGrid:', error);
    if (error.response) {
      console.error(error.response.body);
    }
    // Fallback log pour ne pas bloquer l'utilisateur en dev
    console.log('CODE DE SECOURS (Suite à erreur):', resetCode);
  }
};

exports.sendPasswordChangeConfirmation = async (email, pseudo) => {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn('[EMAIL WARNING] SendGrid non configuré, email de confirmation ignoré.');
    return;
  }

  const msg = {
    to: email,
    from: process.env.EMAIL_FROM || 'deadpions@gmail.com',
    subject: 'Confirmation de changement de mot de passe - DeadPions',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #041c55;">Bonjour ${pseudo},</h2>
        <p>Votre mot de passe DeadPions a été modifié avec succès.</p>
        <div style="background-color: #e8f5e9; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 5px solid #2e7d32;">
          <p style="margin: 0; color: #2e7d32; font-weight: bold;">
            ✅ Modification confirmée
          </p>
        </div>
        <p style="color: #666; font-size: 14px;">
          Si vous n'êtes pas à l'origine de ce changement, veuillez contacter le support immédiatement ou utiliser la fonction "Mot de passe oublié" pour sécuriser votre compte.
        </p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px;">
          Ceci est un message automatique, merci de ne pas y répondre.
        </p>
      </div>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log(`[EMAIL] Confirmation changement mot de passe envoyée à ${email}`);
  } catch (error) {
    console.error('[EMAIL ERROR] Échec envoi confirmation:', error);
  }
};
