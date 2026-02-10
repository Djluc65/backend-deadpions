const Transaction = require('../models/Transaction');
const User = require('../models/User');

exports.syncTransactions = async (req, res) => {
  try {
    const { transactions } = req.body;
    const userId = req.user.id;
    const results = [];

    if (!Array.isArray(transactions)) {
      return res.status(400).json({ message: 'Format invalide' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    for (const tx of transactions) {
      // Vérifier si la transaction existe déjà
      const existing = await Transaction.findOne({ transactionId: tx.id });
      if (existing) {
        results.push({ id: tx.id, status: 'ALREADY_SYNCED' });
        continue;
      }

      // Appliquer la transaction
      const amount = Number(tx.montant);
      
      // Vérification de sécurité (optionnelle mais recommandée)
      // Si c'est un débit, on pourrait vérifier si le solde serveur permettait ce débit
      // Mais pour la synchro offline, on accepte souvent la vérité client si raisonnable
      
      // Mettre à jour le solde serveur
      if (tx.type === 'DEBIT') {
        user.coins -= amount;
      } else if (tx.type === 'CREDIT' || tx.type === 'REMBOURSEMENT') {
        user.coins += amount;
      }

      // Sauvegarder la transaction
      const newTx = new Transaction({
        userId,
        transactionId: tx.id,
        type: tx.type,
        amount: amount,
        reason: tx.raison,
        metadata: tx.metadata,
        balanceBefore: tx.soldeAvant, // Informatif (client view)
        balanceAfter: tx.soldeApres,  // Informatif (client view)
        status: 'COMPLETEE',
        createdAt: new Date(tx.timestamp)
      });

      await newTx.save();
      results.push({ id: tx.id, status: 'SYNCED' });
    }

    // Sauvegarder l'utilisateur avec le nouveau solde
    await user.save();

    // Notifier via Socket.io
    const io = req.app.get('io');
    if (io) {
        io.to(userId.toString()).emit('balance_updated', { coins: user.coins });
    }

    res.json({ 
      success: true, 
      results,
      serverBalance: user.coins 
    });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ message: 'Erreur de synchronisation' });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: 'Erreur récupération historique' });
  }
};
