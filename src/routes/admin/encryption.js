'use strict';

/**
 * Admin Encryption Routes
 * POST /admin/encryption/rotate — re-encrypt all wallet records with the current key version
 */

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../../middleware/rbac');
const Wallet = require('../models/wallet');
const log = require('../../utils/log');

/**
 * POST /admin/encryption/rotate
 * Re-encrypt all wallet label and notes fields with the current ENCRYPTION_KEY_VERSION.
 * Records already encrypted with the current version are skipped.
 * Admin only.
 */
router.post('/rotate', requireAdmin(), async (req, res, next) => {
  try {
    const svc = require('../../services/EncryptionService');
    const targetVersion = parseInt(process.env.ENCRYPTION_KEY_VERSION || '1', 10);

    const wallets = Wallet.loadWallets();
    let rotated = 0;
    let skipped = 0;
    let errors = 0;

    for (const wallet of wallets) {
      if (wallet.deletedAt) { skipped++; continue; }

      let changed = false;
      for (const field of Wallet.ENCRYPTED_FIELDS) {
        const raw = wallet[field];
        if (raw == null) continue;

        // Determine current version of stored value
        const currentVersion = String(raw).startsWith('v')
          ? parseInt(String(raw).split(':')[0].slice(1), 10)
          : 0; // 0 = plaintext (unencrypted)

        if (currentVersion === targetVersion) continue;

        try {
          const plaintext = currentVersion === 0 ? raw : svc.decryptField(raw);
          wallet[field] = svc.encryptField(plaintext, targetVersion);
          changed = true;
        } catch (err) {
          errors++;
          log.error('ENCRYPTION_ROTATE', 'Failed to re-encrypt field', {
            walletId: wallet.id, field, error: err.message,
          });
        }
      }

      if (changed) rotated++;
      else skipped++;
    }

    Wallet.saveWallets(wallets);

    log.info('ENCRYPTION_ROTATE', 'Key rotation complete', { rotated, skipped, errors, targetVersion });
    res.json({ success: true, data: { rotated, skipped, errors, targetVersion } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
