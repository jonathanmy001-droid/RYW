// middleware/upload.js
// ================================================
// Secure image upload middleware for event posters
// Uploads directly to Cloudinary → returns secure URL
// Keeps the server clean and fast
// "Let your light shine" — visuals drawing youth to worship Imana online!

const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Cloudinary storage configuration
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    return {
      folder: 'rwandan-youth-worship/events/posters', // neat organization in your Cloudinary dashboard
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif'],
      transformation: [
        { width: 1200, crop: 'limit' },
        { quality: 'auto:good' },
        { fetch_format: 'auto' }
      ],
      public_id: `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}` // unique filename
    };
  }
});

// Only allow image files
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpg, jpeg, png, gif)'), false);
  }
};

// Multer instance – single file, field name 'poster'
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max – good balance for posters
});

module.exports = upload.single('poster');