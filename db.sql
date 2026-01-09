CREATE DATABASE IF NOT EXISTS haitipay_db;
USE haitipay_db;

-- 1. WalletOwner 
CREATE TABLE IF NOT EXISTS wallet_owners (
    id VARCHAR(50) PRIMARY KEY, 
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(15) NOT NULL UNIQUE,
    date_of_birth DATE NOT NULL,
    national_id VARCHAR(50) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Wallet
CREATE TABLE IF NOT EXISTS wallets (
    id VARCHAR(50) PRIMARY KEY, 
    owner_id VARCHAR(50) NOT NULL,
    balance BIGINT DEFAULT 0,
    pin VARCHAR(4) NOT NULL, 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (owner_id) REFERENCES wallet_owners(id) ON DELETE CASCADE
);

-- 3. Ledger Account 
CREATE TABLE IF NOT EXISTS ledger_accounts (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100),
    balance BIGINT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Transaction 
CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(50) PRIMARY KEY,
    type ENUM('wallet_recharge', 'wallet_transfer', 'bill_payment', 'ledger_debit') NOT NULL,
    from_account_id VARCHAR(50) NOT NULL,
    to_account_id VARCHAR(50) NOT NULL,
    amount BIGINT NOT NULL, 
    fees BIGINT NOT NULL DEFAULT 0,
    description TEXT,
    status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Initialisation du Ledger
INSERT IGNORE INTO ledger_accounts (id, name, balance) 
VALUES ('LEDGER_MASTER', 'HaitiPay Reserve', 1000000000); -- 10 Million goud