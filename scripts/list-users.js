const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');

const connectDB = async () => {
  const uri = process.env.URL_DB;
  if (!uri) {
    console.error('URL_DB manquant dans .env');
    process.exit(1);
  }
  try {
    await mongoose.connect(uri);
    console.log('Connecté à MongoDB');
  } catch (err) {
    console.error('Erreur connexion:', err);
    process.exit(1);
  }
};

const listUsers = async () => {
  await connectDB();
  try {
    const users = await User.find({}, 'pseudo email');
    console.log('\n--- Liste des utilisateurs enregistrés ---');
    if (users.length === 0) {
      console.log('Aucun utilisateur trouvé.');
    } else {
      users.forEach(u => {
        console.log(`- Pseudo: ${u.pseudo}, Email: ${u.email}`);
      });
    }
    console.log('------------------------------------------\n');
  } catch (err) {
    console.error('Erreur:', err);
  } finally {
    await mongoose.connection.close();
  }
};

listUsers();
