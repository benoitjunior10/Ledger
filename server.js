const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { createWalletSchema, isAdult } = require('./utils');
const app = express();

const DAILY_LIMIT_HTG = 50000; 
const DAILY_LIMIT_CENTS = DAILY_LIMIT_HTG * 100;

app.use(express.json());

// Authentification
const authMiddleware = async (req, res, next) => {
    const pin = req.headers['x-pin'];
    if (!pin) {
        return res.status(401).json({ error: 'Unauthorized: x-pin header missing' }); 
    }
    req.authPin = pin;
    next();
};

// Creation Wallet
app.post('/wallet/create', async (req, res) => {
    const conn = await db.getConnection();
    try {
        // Validation des donnees
        const { error, value } = createWalletSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        // Verification Age
        if (!isAdult(value.dateOfBirth)) {
            return res.status(400).json({ error: "L'utilisateur doit avoir au moins 16 ans." });
        }

        await conn.beginTransaction();

        // Verifier que le numero n'est pas deja ete utiliser
        const [existing] = await conn.query('SELECT id FROM wallet_owners WHERE phone_number = ?', [value.phoneNumber]);
        if (existing.length > 0) throw new Error("Ce numéro de téléphone est déjà lié à un wallet.");

        // Creer Owner
        const ownerId = uuidv4();
        await conn.query(
            'INSERT INTO wallet_owners (id, first_name, last_name, phone_number, date_of_birth, national_id) VALUES (?, ?, ?, ?, ?, ?)',
            [ownerId, value.firstName, value.lastName, value.phoneNumber, value.dateOfBirth, value.nationalId]
        );

        // Creer Wallet
        const walletId = `WALLET_${uuidv4().split('-')[0]}`; // ID personnalisé style WALLET_XYZ
        await conn.query(
            'INSERT INTO wallets (id, owner_id, balance, pin) VALUES (?, ?, ?, ?)',
            [walletId, ownerId, 0, value.pin] // Balance initiale 0 
        );

        await conn.commit();

        res.json({
            success: true,
            wallet: {
                id: walletId,
                balance: 0,
                owner: { firstName: value.firstName, lastName: value.lastName, phoneNumber: value.phoneNumber }
            }
        });

    } catch (err) {
        await conn.rollback();
        res.status(500).json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
});

// Recharger (Ledger)
app.post('/wallet/recharge', authMiddleware, async (req, res) => {
    const { phoneNumber, amount } = req.body;
    
    // Validation basique avant connexion DB
    if (!amount || isNaN(amount)) {
        return res.status(400).json({ success: false, message: "Montant invalide" });
    }

    const amountCents = Math.round(amount * 100); // Conversion en centimes
    const conn = await db.getConnection();

    try {
        // Montant entre 50 et 50000 gourdes
        if (amount < 50 || amount > 50000) throw new Error("Montant invalide (min 50, max 50000)");

        await conn.beginTransaction();

        // Récupérer Wallet (et le PIN pour vérification)
        const [wallets] = await conn.query(
            'SELECT w.*, o.first_name, o.last_name FROM wallets w JOIN wallet_owners o ON w.owner_id = o.id WHERE o.phone_number = ? AND w.is_active = 1 FOR UPDATE', 
            [phoneNumber]
        );
        
        if (wallets.length === 0) throw new Error("Wallet introuvable ou inactif");
        const wallet = wallets[0];

        // Verification du PIN
        if (wallet.pin !== req.authPin) {
            throw new Error("Unauthorized: PIN Incorrect pour la recharge");
        }

        // Frais de recharge 2%
        const fees = Math.round(amountCents * 0.02); 
        const totalDebit = amountCents + fees; 

        // Verifier Ledger 
        const [ledger] = await conn.query('SELECT balance FROM ledger_accounts WHERE id = "LEDGER_MASTER" FOR UPDATE');
        // Initialisation si le ledger n'existe pas encore 
        if (ledger.length === 0) throw new Error("Compte Ledger Master introuvable (Veuillez initialiser la DB)");
        
        if (ledger[0].balance < totalDebit) throw new Error("Fonds insuffisants dans le Ledger Master");

        await conn.query('UPDATE ledger_accounts SET balance = balance - ? WHERE id = "LEDGER_MASTER"', [amountCents]); 
        
        // Créditer Wallet
        await conn.query('UPDATE wallets SET balance = balance + ?, last_activity = NOW() WHERE id = ?', [amountCents, wallet.id]);

        const [updatedWallet] = await conn.query('SELECT balance FROM wallets WHERE id = ?', [wallet.id]);
        const [updatedLedger] = await conn.query('SELECT balance FROM ledger_accounts WHERE id = "LEDGER_MASTER"');

        // Enregistrer Transaction
        const txnId = uuidv4(); // Conformité UUID
        await conn.query(
            'INSERT INTO transactions (id, type, from_account_id, to_account_id, amount, fees, description, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [txnId, 'wallet_recharge', 'LEDGER_MASTER', wallet.id, amountCents, fees, 'Recharge via Ledger', 'completed']
        );

        await conn.commit();

        res.json({
            success: true,
            data: {
                walletTransaction: {
                    id: txnId,
                    type: "wallet_recharge",
                    amount: amount,
                    metadata: { 
                        ownerName: `${wallet.first_name} ${wallet.last_name}` 
                    }
                },
                ledgerTransaction: {
                    id: `TXN_LEDGER_${uuidv4().split('-')[0]}`,
                    type: "ledger_debit",
                    amount: amount,
                    newBalance: updatedWallet[0].balance / 100, 
                    ledgerBalance: updatedLedger[0].balance / 100
                }
            }
        });

    } catch (err) {
        await conn.rollback();
        // Gestion code erreur 401 si c'est le PIN
        if (err.message.includes("Unauthorized")) return res.status(401).json({ success: false, message: err.message });
        res.status(400).json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
});

// Profil
app.get('/wallet/:phoneNumber/profile', authMiddleware, async (req, res) => {
    try {
        const { phoneNumber } = req.params;

        const [rows] = await db.query(
            `SELECT 
                w.id AS wallet_id, 
                w.balance, 
                w.created_at AS wallet_created_at, 
                w.last_activity,
                w.pin, -- On le récupère juste pour la vérification, on ne le renverra pas
                o.id AS owner_id,
                o.first_name, 
                o.last_name, 
                o.phone_number, 
                o.date_of_birth, 
                o.national_id
             FROM wallets w 
             JOIN wallet_owners o ON w.owner_id = o.id 
             WHERE o.phone_number = ? AND w.is_active = 1`, 
            [phoneNumber]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: "Wallet introuvable" });
        }

        const walletData = rows[0];

        // Verifier l'authentification (PIN)
        if (walletData.pin !== req.authPin) {
            return res.status(401).json({ success: false, error: "Unauthorized: PIN Incorrect" });
        }

        const profile = {
            wallet: {
                id: walletData.wallet_id,
                balance: walletData.balance / 100, // Conversion centimes en gourdes
                currency: "HTG",
                createdAt: walletData.wallet_created_at,
                lastActivity: walletData.last_activity
            },
            owner: {
                id: walletData.owner_id,
                firstName: walletData.first_name,
                lastName: walletData.last_name,
                phoneNumber: walletData.phone_number,
                dateOfBirth: walletData.date_of_birth, // Format YYYY-MM-DD standard SQL
                nationalId: walletData.national_id
            }
        };

        res.json({
            success: true,
            data: profile
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Erreur serveur lors de la récupération du profil" });
    }
});

// balance
app.get('/wallet/:phoneNumber/balance', authMiddleware, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT w.balance, w.pin FROM wallets w JOIN wallet_owners o ON w.owner_id = o.id WHERE o.phone_number = ?', 
            [req.params.phoneNumber]
        );

        if (rows.length === 0) return res.status(404).json({ error: "Wallet not found" });
        
        // Auth PIN Check 
        if (rows[0].pin !== req.authPin) return res.status(401).json({ error: "Unauthorized: PIN Incorrect" });

        res.json({
            success: true,
            balance: rows[0].balance / 100, // Conversion centimes -> HTG
            currency: "HTG"
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Transfert

app.post('/wallet/transfer', authMiddleware, async (req, res) => {
    const { fromPhone, toPhone, amount, description } = req.body;
    const amountCents = Math.round(amount * 100);
    const conn = await db.getConnection();

    try {
        // Validation Montant
        if (amount < 10 || amount > 25000) throw new Error("Montant invalide (10 - 25000 HTG)");
        if (fromPhone === toPhone) throw new Error("Impossible de transférer à soi-même");

        await conn.beginTransaction();

        //Recuperer Expediteur + Vérifier PIN et Verifier Actif
        const [senders] = await conn.query(
            'SELECT w.* FROM wallets w JOIN wallet_owners o ON w.owner_id = o.id WHERE o.phone_number = ? AND w.is_active = 1 FOR UPDATE', 
            [fromPhone]
        );
        if (senders.length === 0) throw new Error("Expéditeur introuvable ou inactif");
        const senderWallet = senders[0];

        if (senderWallet.pin !== req.authPin) throw new Error("PIN Incorrect pour l'expéditeur");

        //Verifier Limite pour la journee
        const [history] = await conn.query(
            `SELECT SUM(amount) as total_sent FROM transactions 
             WHERE from_account_id = ? 
             AND type = 'wallet_transfer' 
             AND DATE(timestamp) = CURRENT_DATE`,
            [senderWallet.id]
        );
        const totalSentToday = (parseInt(history[0].total_sent) || 0);
        if ((totalSentToday + amountCents) > DAILY_LIMIT_CENTS) {
            throw new Error(`Limite journalière atteinte. Plafond: ${DAILY_LIMIT_HTG} HTG. Déjà envoyé: ${totalSentToday/100} HTG.`);
        }

        // Calcul Frais (2%)
        const fees = Math.round(amountCents * 0.02);
        const totalDeduction = amountCents + fees;

        // Verification Solde
        if (senderWallet.balance < totalDeduction) throw new Error("Solde insuffisant (Montant + 2% frais)");

        // Recuperer Destinataire et Verifier s'il est Actif
        const [receivers] = await conn.query(
            'SELECT w.id FROM wallets w JOIN wallet_owners o ON w.owner_id = o.id WHERE o.phone_number = ? AND w.is_active = 1', 
            [toPhone]
        );
        if (receivers.length === 0) throw new Error("Destinataire introuvable ou inactif");
        const receiverWallet = receivers[0];


        // Debiter Expéditeur (Montant + Frais)
        await conn.query('UPDATE wallets SET balance = balance - ?, last_activity = NOW() WHERE id = ?', [totalDeduction, senderWallet.id]);

        // Crediter Destinataire (Montant uniquement)
        await conn.query('UPDATE wallets SET balance = balance + ? WHERE id = ?', [amountCents, receiverWallet.id]);

        // Crediter Ledger (Commission)
        await conn.query('UPDATE ledger_accounts SET balance = balance + ? WHERE id = "LEDGER_MASTER"', [fees]);

        // Enregistrer Transaction
        const txnId = `TXN_${uuidv4().split('-')[0]}`;
        await conn.query(
            'INSERT INTO transactions (id, type, from_account_id, to_account_id, amount, fees, description, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [txnId, 'wallet_transfer', senderWallet.id, receiverWallet.id, amountCents, fees, description, 'completed']
        );

        await conn.commit();

        res.json({
            success: true,
            transaction: {
                id: txnId,
                type: "wallet_transfer",
                from: fromPhone,
                to: toPhone,
                amount: amount,
                fees: fees / 100,
                fromNewBalance: (senderWallet.balance - totalDeduction) / 100
            }
        });

    } catch (err) {
        await conn.rollback();
        if (err.message.includes("PIN")) return res.status(401).json({ success: false, message: err.message });
        res.status(400).json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
});

// Historique
app.get('/wallet/:phoneNumber/transactions', authMiddleware, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        
        // Verification Wallet et PIN
        const [wallets] = await db.query(
            'SELECT w.id, w.pin FROM wallets w JOIN wallet_owners o ON w.owner_id = o.id WHERE o.phone_number = ?', 
            [req.params.phoneNumber]
        );
        if (wallets.length === 0 || wallets[0].pin !== req.authPin) return res.status(401).json({ error: "Unauthorized" });

        const walletId = wallets[0].id;

        const [txns] = await db.query(
            `SELECT * FROM transactions 
             WHERE from_account_id = ? OR to_account_id = ? 
             ORDER BY timestamp DESC LIMIT ?`,
            [walletId, walletId, limit]
        );

        res.json({ success: true, data: txns });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

//Statut
app.get('/admin/ledger/status', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM ledger_accounts WHERE id = "LEDGER_MASTER"');
        if (rows.length === 0) return res.status(404).json({ error: "Ledger introuvable" });

        res.json({
            success: true,
            ledger: {
                id: rows[0].id,
                name: rows[0].name,
                balance: rows[0].balance / 100,
                currency: "HTG",
                last_updated: new Date()
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

//Historique Ledger (Admin)
app.get('/admin/ledger/transactions', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        
        const [txns] = await db.query(
            `SELECT * FROM transactions 
             WHERE from_account_id = "LEDGER_MASTER" OR to_account_id = "LEDGER_MASTER"
             ORDER BY timestamp DESC LIMIT ?`,
            [limit]
        );

        res.json({ 
            success: true, 
            count: txns.length, 
            data: txns 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`HaitiPay Server running on port ${PORT}`);
});