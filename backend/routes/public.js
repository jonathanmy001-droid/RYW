const express = require('express');
const router = express.Router();

const ContactMessage = require('../models/contactMessage');
const NewsletterSubscriber = require('../models/newsletterSubscriber');

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// POST /api/public/contact
router.post('/contact', async (req, res) => {
  try {
    const { name, email, subject, message, source } = req.body || {};

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }
    if (!message || String(message).trim().length < 10) {
      return res.status(400).json({ success: false, message: 'Message must be at least 10 characters' });
    }

    await ContactMessage.create({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      subject: String(subject || '').trim(),
      message: String(message).trim(),
      source: String(source || 'website').trim(),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').slice(0, 80),
    });

    res.status(201).json({ success: true, message: 'Message received. We will respond soon.' });
  } catch (err) {
    console.error('Public contact error:', err);
    res.status(500).json({ success: false, message: 'Could not send message' });
  }
});

// POST /api/public/subscribe
router.post('/subscribe', async (req, res) => {
  try {
    const { email, source } = req.body || {};
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }

    const normalized = String(email).trim().toLowerCase();

    await NewsletterSubscriber.updateOne(
      { email: normalized },
      { $setOnInsert: { email: normalized, source: String(source || 'website').trim(), subscribedAt: new Date() } },
      { upsert: true }
    );

    res.status(201).json({ success: true, message: 'Subscribed successfully' });
  } catch (err) {
    console.error('Public subscribe error:', err);
    res.status(500).json({ success: false, message: 'Could not subscribe' });
  }
});

module.exports = router;

