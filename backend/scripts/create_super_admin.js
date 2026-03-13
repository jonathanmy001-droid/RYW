#!/usr/bin/env node
/* eslint-disable no-console */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const User = require('../models/user');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith('--')) return null;
  return value;
}

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Missing MONGODB_URI in backend/.env');
    process.exit(1);
  }

  const firstName = getArg('--firstName') || 'Super';
  const lastName = getArg('--lastName') || 'Admin';
  const username = getArg('--username');
  const email = getArg('--email');
  const password = getArg('--password');

  if (!username || !email || !password) {
    console.error('Usage: node scripts/create_super_admin.js --username <u> --email <e> --password <p> [--firstName <f>] [--lastName <l>]');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });

  try {
    const normalizedEmail = String(email).toLowerCase().trim();
    const normalizedUsername = String(username).toLowerCase().trim();

    const existing = await User.findOne({ $or: [{ email: normalizedEmail }, { username: normalizedUsername }] });
    if (existing) {
      console.log('User already exists. Updating role to super_admin and approving...');
      existing.role = 'super_admin';
      existing.isApproved = true;
      existing.lastActive = existing.lastActive || new Date();
      await existing.save();
      console.log('Updated:', { id: existing._id.toString(), email: existing.email, username: existing.username, role: existing.role });
      return;
    }

    const user = new User({
      firstName,
      lastName,
      username: normalizedUsername,
      email: normalizedEmail,
      password: String(password),
      role: 'super_admin',
      isApproved: true,
      school: null,
      lastActive: new Date(),
    });

    await user.save();
    console.log('Created:', { id: user._id.toString(), email: user.email, username: user.username, role: user.role });
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
