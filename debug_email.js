const mongoose = require('mongoose');
const dns = require('dns').promises;
require('dotenv').config();

const uri = process.env.URL_DB || process.env.MONGODB_URI;

async function check() {
  console.log('--- Testing DNS Resolution for gmail.com ---');
  try {
    const addresses = await dns.resolveMx('gmail.com');
    console.log('DNS MX Records found:', addresses);
  } catch (error) {
    console.error('DNS Resolution Failed:', error);
  }

  console.log('\n--- Checking User in DB ---');
  if (!uri) {
    console.log('No MongoDB URI found in environment');
    return;
  }

  try {
    await mongoose.connect(uri);
    const User = require('./src/models/User');
    const email = 'djluc6556@gmail.com';
    const user = await User.findOne({ email });
    if (user) {
      console.log(`User found with email ${email}:`, user.pseudo);
    } else {
      console.log(`No user found with email ${email}`);
    }
  } catch (error) {
    console.error('DB Check Failed:', error);
  } finally {
    await mongoose.disconnect();
  }
}

check();
