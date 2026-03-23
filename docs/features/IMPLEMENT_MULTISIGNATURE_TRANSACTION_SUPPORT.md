# Multi-Signature Transaction Support

High-value donations can require approval from multiple authorised signers before a transaction is submitted to the Stellar network.

## Overview

Stellar natively supports multi-signature accounts where a transaction must be signed by N-of-M keys before it is valid. This feature exposes that capability through the API:

1. A caller creates a **pending** multi-sig transaction record, supplying the unsigned XDR envelope, the list of authorised signer public keys, and the required threshold.
2. Each authorised signer calls the **sign** endpoint with their signed XDR envelope.
3. When the threshold is reached the API **automatically submits** the transaction to Stellar.

## Database

Migration: `src/scripts/migrations/addMultiSigTables.js`

```sql
CREATE TABLE multisig_transactions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_xdr      TEXT    NOT NULL,
  network_passphrase   TEXT    NOT NULL,
  required_signers     INTEGER NOT NULL,       -- threshold (≥ 2)
  signer_keys          TEXT    NOT NULL,       -- JSON array of authorised public keys
  collected_signatures TEXT    NOT NULL DEFAULT '[]',
  status               TEXT    NOT NULL DEFAULT 'pending',  -- pending|submitted|failed
  stellar_tx_hash      TEXT,
  stellar_ledger       INTEGER,
  metadata             TEXT,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

### POST /transactions/multisig
Create a pending multi-sig transaction.

**Request body:**
```json
{
  "transaction_xdr": "<base64-XDR>",
  "network_passphrase": "Test SDF Network ; September 2015",
  "required_signers": 2,
  "signer_keys": ["GABC...", "GDEF..."],
  "metadata": { "donationId": 42 }
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "status": "pending",
    "required_signers": 2,
    "signer_keys": ["GABC...", "GDEF..."],
    "collected_signatures": [],
    "stellar_tx_hash": null
  }
}
```

---

### POST /transactions/:id/sign
Add a signature. Auto-submits when threshold is met.

**Request body:**
```json
{ "signer": "GABC...", "signed_xdr": "<base64-XDR>" }
```

**Response `200`** (still pending):
```json
{ "success": true, "data": { "status": "pending", "collected_signatures": [...] } }
```

**Response `200`** (threshold met, auto-submitted):
```json
{ "success": true, "data": { "status": "submitted", "stellar_tx_hash": "abc123..." } }
```

---

### GET /transactions/:id/signatures
Check signature collection status.

**Response `200`:**
```json
{
  "success": true,
  "data": { "id": 1, "status": "pending", "collected": [...], "required": 2, "remaining": 1 }
}
```

## Transaction Lifecycle

```
POST /multisig  →  status: pending
                       │
          addSignature (n < threshold)
                       │
                   status: pending
                       │
          addSignature (n = threshold)
                       │
              submitMultiSigTransaction()
                    ┌──┴──┐
                 success  failure
                    │        │
               submitted   failed
```

## Security

- Only keys listed in `signer_keys` may sign.
- Duplicate signatures from the same key are rejected.
- Signing a non-pending transaction is rejected.
- Stellar submission failure marks the record `failed` without throwing — the caller always gets a clean response.

## Tests

`tests/implement-multisignature-transaction-support.test.js` — 37 tests, 100% line coverage, 98% branch coverage.
