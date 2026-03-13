// One-time migration:
// - For each Prayer Group (backend/models/group.js) ensure it has a linked ChatGroup.
// - Ensure all prayer group members have ChatMembership in that linked ChatGroup.
//
// Run:
//   cd backend
//   node scripts/migrate_prayer_groups_to_chat.js

require('dotenv').config();

const mongoose = require('mongoose');
const { migratePrayerGroupsToChat } = require('../services/migratePrayerGroupsToChat');

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('Missing MONGODB_URI in backend/.env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const result = await migratePrayerGroupsToChat({});
  console.log('Migration complete');
  console.log(result);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
