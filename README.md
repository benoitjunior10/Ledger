## 🛠️ Stack Technique

| Composant | Technologie | Rôle |
| :--- | :--- | :--- |
| **Backend** | Node.js / Express.js | API RESTful asynchrone |
| **Base de Données** | MySQL 8.x | Persistance des données (Ledger, Wallets, Transactions) |
| **Dépendances Clés** | `mysql2`, `express`, `uuid`, `dotenv`, `joi` | Driver DB, Framework, Génération d'ID, Variables d'environnement, Validation des schémas |
| **Logique Financière**| Transactions ACID & BIGINT | Garantie d'intégrité et précision des fonds (stockés en centimes) |

---

## 🚀 Démarrage du Projet

### 1. Prérequis

* Node.js
* MySQL Server

### 2. Configuration de la Base de Données

1.  **Créer la base de données :**
    Exécutez les commandes de création et d'initialisation des tables contenues dans le fichier `db.sql`.

    ```bash
    mysql -u [votre_user] -p < db.sql
    ```

2.  **Configuration des identifiants :**
    Créez un fichier `.env` à la racine du projet et configurez les variables de connexion (selon le modèle du fichier `db.js`) :

    ```env
    DB_HOST=localhost
    DB_USER=root
    DB_PASSWORD=votre_mot_de_passe
    DB_NAME=haitipay_db
    PORT=3000
    ```

### 3. Lancement de l'API

1.  **Installer les dépendances :**
    ```bash
    npm install
    ```
2.  **Lancer le serveur :**
    ```bash
    node server.js
    ```
    L'API sera disponible à l'adresse `http://localhost:3000`.

---

## 💡 Principes de Conception & Logique Métier

### 1. Intégrité Financière (Transactions ACID)

* Toutes les opérations sensibles (`/recharge` et `/transfert`) sont encapsulées dans des **transactions MySQL (`beginTransaction`, `commit`, `rollback`)**.
* **Objectif :** Garantir que toutes les écritures (débit, crédit, frais) réussissent ou échouent ensemble. Aucune perte de fonds n'est possible en cas d'erreur ou de crash.
* Les soldes sont stockés en **centimes (BIGINT)** pour éviter les erreurs d'arrondi des nombres flottants.

### 2. Sécurité & Validation

* **Authentification :** Les endpoints sensibles utilisent le middleware `authMiddleware` pour vérifier l'existence du PIN du Wallet dans le Header HTTP (`x-pin`).
* **Validation des Schémas :** Utilisation de la librairie **`Joi`** pour valider les données entrantes (ex: format du numéro de téléphone `+509`, vérification de l'âge minimum de 16 ans).

### 3. Logique du Ledger

* Le `Ledger` est un compte central (`LEDGER_MASTER`) qui sert de contrepartie à toute recharge ou décharge.
* **Frais :** Des frais de **2%** sont appliqués sur tous les transferts et sont crédités directement sur le compte `LEDGER_MASTER`.

---

## 🔗 Endpoints de l'API

Tous les endpoints sont préfixés par `/wallet`. L'accès est par défaut sur `http://localhost:3000`.

| Méthode | Endpoint | Description | Authentification (`x-pin`) |
| :--- | :--- | :--- | :---: |
| `POST` | `/wallet/create` | Crée un nouveau `WalletOwner` et son `Wallet` associé. | ❌ Non |
| `GET` | `/wallet/:id/balance` | Consulte le solde actuel d'un Wallet. | ✅ Oui |
| `POST` | `/wallet/recharge` | Crédite un Wallet à partir du `LEDGER_MASTER`. | ✅ Oui |
| `POST` | `/wallet/transfert` | Transfère des fonds entre deux Wallets (avec frais de 2%). | ✅ Oui |
| `GET` | `/wallet/:id/history` | Récupère l'historique des transactions d'un Wallet. | ✅ Oui |

### Endpoints d'Administration

| Méthode | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/admin/ledger/status` | Affiche le solde actuel du compte central (Ledger). |
| `GET` | `/admin/ledger/transactions` | Affiche l'historique des mouvements impliquant le Ledger. |