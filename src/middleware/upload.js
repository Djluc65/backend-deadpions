const multer = require('multer');
const path = require('path');

// Configuration de stockage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const prefix = file.mimetype.startsWith('audio') ? 'audio-' : 'image-';
    cb(null, prefix + uniqueSuffix + path.extname(file.originalname || '.jpg'));
  }
});

// Filtre pour les fichiers images et audio
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/') || file.mimetype === 'application/octet-stream') {
    cb(null, true);
  } else {
    cb(new Error('Format de fichier non supporté'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // Limite à 10MB
  }
});

module.exports = upload;
