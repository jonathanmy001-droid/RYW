require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/user');
const ChatMembership = require('../models/chatMembership');
const ChatGroup = require('../models/chatGroup');

async function main() {
  const q = (process.argv[2] || '').trim();
  if (!q) {
    console.log('Usage: node scripts/debug_chat_membership.js <searchTerm>');
    console.log('Example: node scripts/debug_chat_membership.js quentin');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const users = await User.find({
    $or: [
      { firstName: { $regex: q, $options: 'i' } },
      { lastName: { $regex: q, $options: 'i' } },
      { username: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
    ],
  })
    .select('firstName lastName username email role school isApproved isLocked')
    .lean();

  console.log('Users matching:', q);
  console.log(users);

  const u = users[0];
  if (!u) {
    console.log('No user found.');
    process.exit(0);
  }

  const mem = await ChatMembership.find({ user: u._id })
    .populate('group')
    .lean();

  console.log('Memberships for first match:', {
    id: String(u._id),
    email: u.email,
    username: u.username,
    school: u.school ? String(u.school) : null,
  });
  console.log(
    mem.map((m) => ({
      id: String(m._id),
      status: m.status,
      roleInGroup: m.roleInGroup,
      group: m.group
        ? {
            id: String(m.group._id),
            name: m.group.name,
            visibility: m.group.visibility,
            joinPolicy: m.group.joinPolicy,
            school: m.group.school ? String(m.group.school) : null,
            isActive: m.group.isActive,
            isDiscoverable: m.group.isDiscoverable,
          }
        : null,
    }))
  );

  const recent = await ChatGroup.find().sort({ createdAt: -1 }).limit(10).lean();
  console.log('Recent groups:', recent.map((g) => ({
    id: String(g._id),
    name: g.name,
    visibility: g.visibility,
    joinPolicy: g.joinPolicy,
    school: g.school ? String(g.school) : null,
    isDiscoverable: g.isDiscoverable,
    isActive: g.isActive,
  })));

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

