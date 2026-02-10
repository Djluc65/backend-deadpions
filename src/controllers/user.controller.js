const User = require('../models/User');
const { EARLY_ACCESS_END_DATE } = require('../config');

// Obtenir le profil de l'utilisateur courant
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }
    const userData = user.toObject();
    const isEarlyAccess = new Date() < EARLY_ACCESS_END_DATE;
    userData.isPremium = isEarlyAccess || userData.isPremium;
    res.json(userData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Obtenir un utilisateur par ID
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }
    const userData = user.toObject();
    const isEarlyAccess = new Date() < EARLY_ACCESS_END_DATE;
    userData.isPremium = isEarlyAccess || userData.isPremium;
    res.json(userData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Rechercher des utilisateurs par pseudo
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ message: 'Veuillez fournir un terme de recherche.' });
    }

    const users = await User.find({
      pseudo: { $regex: q, $options: 'i' }
    }).select('pseudo avatar stats');

    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Obtenir la liste des amis
exports.getFriends = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('friends', 'pseudo avatar status isOnline');
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }
    res.json(user.friends);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Obtenir tous les utilisateurs en ligne (sauf soi-même)
exports.getOnlineUsers = async (req, res) => {
  try {
    const users = await User.find({ 
      isOnline: true, 
      _id: { $ne: req.user.id } // Exclure l'utilisateur courant
    })
    .select('pseudo avatar country stats coins')
    .limit(50); // Limiter pour éviter les grosses charges

    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Mettre à jour le profil utilisateur
exports.updateUser = async (req, res) => {
  try {
    const { pseudo, email, password, country, avatar } = req.body;

    const user = await User.findById(req.user.id);

    if (pseudo) user.pseudo = pseudo;
    if (email) user.email = email;
    if (country) user.country = country;
    if (password) user.password = password; // Le middleware pre-save hachera

    // Gestion de l'avatar
    if (req.file) {
       // Multer stocke le fichier dans req.file
       // Le chemin d'accès relatif sera '/uploads/filename'
       user.avatar = `/uploads/${req.file.filename}`;
    } else if (avatar) {
        // Si avatar est envoyé comme string (URL ou chemin déjà existant)
        user.avatar = avatar;
    }

    const updatedUser = await user.save();

    const isEarlyAccess = new Date() < EARLY_ACCESS_END_DATE;

    res.json({
      _id: updatedUser._id,
      pseudo: updatedUser.pseudo,
      email: updatedUser.email,
      avatar: updatedUser.avatar,
      country: updatedUser.country,
      coins: updatedUser.coins,
      stats: updatedUser.stats,
      isPremium: isEarlyAccess || updatedUser.isPremium,
      isEarlyAccess: isEarlyAccess,
      earlyAccessEndDate: isEarlyAccess ? EARLY_ACCESS_END_DATE : null,
      subscriptionEndDate: updatedUser.subscriptionEndDate,
      dailyCreatedRooms: updatedUser.dailyCreatedRooms,
      token: generateToken(updatedUser._id),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Désactiver le compte
exports.deactivateAccount = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { isActive: false });
    res.json({ message: 'Compte désactivé avec succès.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Supprimer le compte
exports.deleteAccount = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user.id);
    res.json({ message: 'Compte supprimé avec succès.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

const generateToken = (id) => {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};
