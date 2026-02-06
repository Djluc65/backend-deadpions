const Stripe = require('stripe');
const User = require('../models/User');

let stripe;
if (process.env.STRIPE_SECRET_KEY) {
    stripe = Stripe(process.env.STRIPE_SECRET_KEY);
} else {
    console.warn('⚠️ STRIPE_SECRET_KEY manquante. Les paiements ne fonctionneront pas.');
}

const COIN_PACKS = {
    'pack_beginner': { coins: 50000, amount: 199, currency: 'eur' },
    'pack_popular': { coins: 100000, amount: 299, currency: 'eur' },
    'pack_bestseller': { coins: 500000, amount: 599, currency: 'eur' },
    'pack_pro': { coins: 1000000, amount: 1099, currency: 'eur' },
    'pack_expert': { coins: 2500000, amount: 2099, currency: 'eur' },
    'pack_whale': { coins: 5000000, amount: 2999, currency: 'eur' },
};

exports.createPaymentIntent = async (req, res) => {
    if (!stripe) {
        return res.status(503).json({ message: 'Service de paiement indisponible (Configuration manquante)' });
    }

    try {
        const { packId } = req.body;
        const pack = COIN_PACKS[packId];

        if (!pack) {
            return res.status(400).json({ message: 'Pack invalide' });
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: pack.amount,
            currency: pack.currency,
            metadata: {
                userId: req.user.id,
                packId: packId,
                coins: pack.coins
            },
            automatic_payment_methods: {
                enabled: true,
            },
        });

        res.json({
            clientSecret: paymentIntent.client_secret,
            pack: pack
        });
    } catch (error) {
        console.error('Erreur createPaymentIntent:', error);
        res.status(500).json({ message: 'Erreur lors de la création du paiement' });
    }
};

exports.verifyPayment = async (req, res) => {
    if (!stripe) {
        return res.status(503).json({ message: 'Service de paiement indisponible' });
    }

    try {
        const { paymentIntentId } = req.body;
        const userId = req.user.id;

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (paymentIntent.status === 'succeeded') {
            // Vérifier si déjà traité (idéalement via une table de transactions pour éviter les doublons)
            // Pour l'instant, on vérifie juste le statut et les métadonnées
            
            if (paymentIntent.metadata.userId !== userId) {
                return res.status(403).json({ message: 'Utilisateur non autorisé pour ce paiement' });
            }

            // Créditer les coins
            const coinsToAdd = parseInt(paymentIntent.metadata.coins, 10);
            
            // Mise à jour atomique
            const user = await User.findByIdAndUpdate(
                userId, 
                { $inc: { coins: coinsToAdd } },
                { new: true }
            );

            // TODO: Enregistrer la transaction en BDD

            res.json({ 
                success: true, 
                newBalance: user.coins,
                message: `Paiement réussi ! ${coinsToAdd.toLocaleString()} coins ajoutés.`
            });
        } else {
            res.status(400).json({ message: 'Le paiement n\'est pas validé', status: paymentIntent.status });
        }
    } catch (error) {
        console.error('Erreur verifyPayment:', error);
        res.status(500).json({ message: 'Erreur lors de la vérification du paiement' });
    }
};

exports.getKits = (req, res) => {
    res.json(COIN_PACKS);
};
