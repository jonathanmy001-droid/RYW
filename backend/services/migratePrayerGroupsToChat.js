const Group = require('../models/group');
const ChatGroup = require('../models/chatGroup');
const ChatMembership = require('../models/chatMembership');

async function ensureChatForPrayerGroup(prayerGroup) {
  let chatGroup = null;

  if (prayerGroup.chatGroup) {
    chatGroup = await ChatGroup.findById(prayerGroup.chatGroup);
  }

  if (!chatGroup) {
    if (!prayerGroup.createdBy) {
      return { linked: false, createdChatGroup: false, reason: 'missing_createdBy' };
    }

    chatGroup = await ChatGroup.create({
      name: prayerGroup.name,
      description: prayerGroup.description || '',
      school: prayerGroup.school,
      visibility: 'school_only',
      joinPolicy: 'invite_only',
      isDiscoverable: true,
      isActive: true,
      createdBy: prayerGroup.createdBy,
      lastMessageAt: null,
    });

    prayerGroup.chatGroup = chatGroup._id;
    await prayerGroup.save();
  }

  const chatGroupId = prayerGroup.chatGroup;

  // Creator is owner
  if (prayerGroup.createdBy) {
    await ChatMembership.updateOne(
      { group: chatGroupId, user: prayerGroup.createdBy },
      { $setOnInsert: { roleInGroup: 'owner', joinedAt: new Date() }, $set: { status: 'active' } },
      { upsert: true }
    );
  }

  // Sync members
  const members = Array.isArray(prayerGroup.members) ? prayerGroup.members : [];
  for (const userId of members) {
    await ChatMembership.updateOne(
      { group: chatGroupId, user: userId },
      { $setOnInsert: { roleInGroup: 'member', joinedAt: new Date() }, $set: { status: 'active' } },
      { upsert: true }
    );
  }

  return { linked: true, createdChatGroup: !chatGroup, chatGroupId: String(chatGroupId) };
}

async function migratePrayerGroupsToChat({ limit = 0 } = {}) {
  const filter = {};
  const q = Group.find(filter).select('name description school createdBy members chatGroup').sort({ createdAt: 1 });
  if (limit && Number(limit) > 0) q.limit(Number(limit));

  const groups = await q;

  let linked = 0;
  let createdChatGroups = 0;
  let skipped = 0;

  for (const g of groups) {
    const hadChat = Boolean(g.chatGroup);
    const res = await ensureChatForPrayerGroup(g);
    if (!res.linked) {
      skipped += 1;
      continue;
    }
    linked += 1;
    if (!hadChat && g.chatGroup) createdChatGroups += 1;
  }

  return {
    totalPrayerGroups: groups.length,
    linked,
    createdChatGroups,
    skipped,
  };
}

module.exports = {
  migratePrayerGroupsToChat,
};

