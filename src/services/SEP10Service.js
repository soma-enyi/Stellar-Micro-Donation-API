/**
 * SEP-0010 Service - Stellar Web Authentication
 *
 * RESPONSIBILITY: Challenge generation and verification for SEP-0010 web authentication
 * OWNER: Security Team
 * DEPENDENCIES: Stellar SDK, crypto utilities, JWT service
 *
 * Implements Stellar Ecosystem Proposal 0010 for web authentication using
 * challenge-response with Stellar keypairs. Generates time-bound challenges
 * and verifies signed transactions to authenticate users.
 */

const crypto = require('crypto');
const StellarSdk = require('stellar-sdk');
const { issueAccessToken } = require('./JwtService');
const log = require('../utils/log');
const { ValidationError, BusinessLogicError, ERROR_CODES } = require('../utils/errors');

class SEP10Service {
  constructor(stellarService, config = {}) {
    this.stellarService = stellarService;
    this.config = {
      challengeExpiresIn: config.challengeExpiresIn || 15 * 60 * 1000, // 15 minutes
      serverSigningKey: config.serverSigningKey,
      homeDomain: config.homeDomain || 'localhost',
      ...config
    };

    if (!this.config.serverSigningKey) {
      throw new Error('SEP10Service requires serverSigningKey configuration');
    }
  }

  /**
   * Generate a SEP-0010 challenge transaction
   * Creates a manageData operation with a time-bound memo for client signing
   *
   * @param {string} clientAccount - The client's Stellar public key
   * @returns {string} XDR-encoded challenge transaction
   */
  async generateChallenge(clientAccount) {
    try {
      // Validate client account format
      if (!StellarSdk.StrKey.isValidEd25519PublicKey(clientAccount)) {
        throw new ValidationError(
          'Invalid Stellar public key format',
          null,
          ERROR_CODES.INVALID_REQUEST
        );
      }

      // Get server account for challenge
      const serverKeypair = StellarSdk.Keypair.fromSecret(this.config.serverSigningKey);
      const serverAccount = await this.stellarService.loadAccount(serverKeypair.publicKey());

      // Generate unique challenge string
      const challenge = this._generateChallengeString();

      // Create time-bound memo (expires in 15 minutes)
      const expiresAt = Math.floor((Date.now() + this.config.challengeExpiresIn) / 1000);
      const memo = `${this.config.homeDomain} auth ${challenge} ${expiresAt}`;

      // Build transaction with manageData operation
      const transaction = new StellarSdk.TransactionBuilder(serverAccount, {
        fee: this.stellarService.baseFee,
        networkPassphrase: this.stellarService.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.manageData({
          name: `web_auth_${challenge}`,
          value: clientAccount,
        }))
        .addMemo(StellarSdk.Memo.text(memo))
        .setTimeout(0) // No timeout, rely on memo expiration
        .build();

      // Sign with server key
      transaction.sign(serverKeypair);

      log.info('SEP10', 'Challenge transaction generated', {
        clientAccount: this._maskPublicKey(clientAccount),
        challengeId: challenge,
        expiresAt: new Date(expiresAt * 1000).toISOString()
      });

      return transaction.toXDR();

    } catch (error) {
      log.error('SEP10', 'Failed to generate challenge', { error: error.message });
      throw error;
    }
  }

  /**
   * Verify a signed challenge transaction and extract authenticated account
   *
   * @param {string} signedTransactionXDR - The signed challenge transaction in XDR
   * @returns {string} The authenticated Stellar public key
   */
  async verifyChallenge(signedTransactionXDR) {
    try {
      // Parse the signed transaction
      const transaction = StellarSdk.TransactionBuilder.fromXDR(
        signedTransactionXDR,
        this.stellarService.networkPassphrase
      );

      // Verify transaction hasn't expired based on memo
      this._verifyTransactionMemo(transaction);

      // Verify the transaction structure and determine the client account
      const clientAccount = this._verifyChallengeStructure(transaction);

      // Verify server signature is present
      this._verifyServerSignature(transaction);

      // Verify client signature
      this._verifyTransactionSignatures(transaction, clientAccount);

      log.info('SEP10', 'Challenge verification successful', {
        account: this._maskPublicKey(clientAccount)
      });

      return clientAccount;

    } catch (error) {
      log.error('SEP10', 'Challenge verification failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Issue a JWT token for a successfully authenticated Stellar account
   *
   * @param {string} stellarAccount - The authenticated Stellar public key
   * @param {object} [claims={}] - Additional claims for the JWT
   * @returns {string} JWT access token
   */
  issueAuthToken(stellarAccount, claims = {}) {
    // Create claims for Stellar-based authentication
    const jwtClaims = {
      sub: stellarAccount, // Subject is the Stellar account
      auth_method: 'sep10',
      role: 'user', // Default role, could be enhanced with account-based roles
      ...claims
    };

    return issueAccessToken(jwtClaims);
  }

  /**
   * Generate a unique challenge string
   * @private
   * @returns {string} Random challenge identifier
   */
  _generateChallengeString() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Verify transaction memo and extract expiration time
   * @private
   * @param {Transaction} transaction
   * @returns {string} The authenticated account from the memo
   */
  _verifyTransactionMemo(transaction) {
    if (!transaction.memo || transaction.memo.type !== StellarSdk.MemoText) {
      throw new ValidationError(
        'Invalid challenge transaction: missing or invalid memo',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const memoText = transaction.memo.value.toString();
    const parts = memoText.split(' ');

    if (parts.length !== 4 || parts[0] !== this.config.homeDomain || parts[1] !== 'auth') {
      throw new ValidationError(
        'Invalid challenge transaction: malformed memo',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const expiresAt = parseInt(parts[3], 10);
    if (isNaN(expiresAt) || Date.now() / 1000 > expiresAt) {
      throw new ValidationError(
        'Challenge transaction has expired',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    return true;
  }

  /**
   * Verify transaction signatures
   * @private
   * @param {Transaction} transaction
   * @param {string} expectedAccount - Expected signer account
   */
  _verifyTransactionSignatures(transaction, expectedAccount) {
    // For SEP-0010, the transaction should be signed by the client account
    const clientKeypair = StellarSdk.Keypair.fromPublicKey(expectedAccount);

    try {
      // Check if the transaction has a valid signature from the client
      const validSignatures = transaction.signatures.filter(sig => {
        try {
          return clientKeypair.verify(transaction.hash(), sig.signature());
        } catch {
          return false;
        }
      });

      if (validSignatures.length === 0) {
        throw new ValidationError(
          'Challenge transaction not signed by claimed account',
          null,
          ERROR_CODES.INVALID_REQUEST
        );
      }
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError(
        'Invalid signature on challenge transaction',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }
  }

  /**
   * Verify server signature is present on the challenge transaction
   * @private
   * @param {Transaction} transaction
   */
  _verifyServerSignature(transaction) {
    const serverKeypair = StellarSdk.Keypair.fromSecret(this.config.serverSigningKey);
    const serverPublic = serverKeypair.publicKey();

    try {
      const serverSignatureValid = transaction.signatures.some(sig => {
        try {
          return serverKeypair.verify(transaction.hash(), sig.signature());
        } catch {
          return false;
        }
      });

      if (!serverSignatureValid) {
        throw new ValidationError(
          'Challenge transaction missing or invalid server signature',
          null,
          ERROR_CODES.INVALID_REQUEST
        );
      }
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError(
        'Invalid server signature on challenge transaction',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }
  }

  /**
   * Verify the transaction structure matches SEP-0010 challenge format
   * @private
   * @param {Transaction} transaction
   * @returns {string} Client Stellar public key extracted from operation value
   */
  _verifyChallengeStructure(transaction) {
    if (transaction.operations.length !== 1) {
      throw new ValidationError(
        'Invalid challenge transaction: must have exactly one operation',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const operation = transaction.operations[0];
    if (operation.type !== 'manageData') {
      throw new ValidationError(
        'Invalid challenge transaction: must be a manageData operation',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const clientAccount = operation.value.toString();
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(clientAccount)) {
      throw new ValidationError(
        'Invalid challenge transaction: manageData value must be a valid Stellar public key',
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    return clientAccount;
  }

  /**
   * Mask a public key for logging (show first and last 4 characters)
   * @private
   * @param {string} publicKey
   * @returns {string} Masked public key
   */
  _maskPublicKey(publicKey) {
    if (publicKey.length < 8) return publicKey;
    return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
  }
}

module.exports = SEP10Service;