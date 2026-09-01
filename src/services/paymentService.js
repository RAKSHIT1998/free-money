// Payment service for handling real fiat currency transactions
// Supports multiple payment providers (Stripe, PayPal, etc.)

const Stripe = require('stripe');
const axios = require('axios');

class PaymentService {
  // Was previously eager/fatal: this constructor threw straight out of module load
  // if STRIPE_SECRET_KEY (or PAYPAL_CLIENT_ID/SECRET) wasn't set, and since this
  // module is required transitively by gigRoutes/walletRoutes at server startup,
  // that took the ENTIRE app down before app.listen() ever ran — real crash-loop
  // seen on a fresh deploy with no payment provider configured. Fiat payments are
  // an optional feature (same "idle, not an error, if unconfigured" posture as
  // telegramNotifier elsewhere in this app) — a missing key here should only ever
  // fail the specific payment call that needed it, not the whole server.
  constructor() {
    try {
      this.provider = this.initializePaymentProvider();
      this.initError = null;
    } catch (error) {
      this.provider = null;
      this.initError = error.message;
      console.warn(`PaymentService not configured (${error.message}) — fiat payment features disabled, everything else unaffected.`);
    }
  }

  assertConfigured() {
    if (!this.provider) {
      throw new Error(`Payment provider not configured: ${this.initError}`);
    }
  }

  /**
   * Initialize the payment provider based on configuration
   * @returns {Object} Payment provider instance
   */
  initializePaymentProvider() {
    const provider = process.env.PAYMENT_PROVIDER || 'stripe';

    switch (provider.toLowerCase()) {
      case 'stripe':
        return this.initializeStripe();
      case 'paypal':
        return this.initializePayPal();
      default:
        throw new Error(`Unsupported payment provider: ${provider}`);
    }
  }

  /**
   * Initialize Stripe payment provider
   * @returns {Object} Stripe instance
   */
  initializeStripe() {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    return Stripe(stripeSecretKey);
  }

  /**
   * Initialize PayPal payment provider
   * @returns {Object} PayPal client configuration
   */
  initializePayPal() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const sandbox = process.env.PAYPAL_SANDBOX === 'true';

    if (!clientId || !clientSecret) {
      throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables are required');
    }

    return {
      clientId,
      clientSecret,
      sandbox,
      baseUrl: sandbox
        ? 'https://api-m.sandbox.paypal.com'
        : 'https://api-m.paypal.com'
    };
  }

  /**
   * Create a payment intent/invoice for receiving payments
   * @param {number} amount - Amount in USD
   * @param {string} currency - Currency code (usd, eur, etc.)
   * @param {string} description - Description of the payment
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Payment details
   */
  async createPaymentIntent(amount, currency = 'usd', description = '', metadata = {}) {
    this.assertConfigured();
    try {
      // Convert amount to cents for Stripe (assuming amount is in USD)
      const amountInCents = Math.round(amount * 100);

      if (this.provider instanceof Stripe) {
        // Stripe implementation
        const paymentIntent = await this.provider.paymentIntents.create({
          amount: amountInCents,
          currency: currency.toLowerCase(),
          description,
          metadata,
          // Automatically confirm with payment method if provided
          // confirmation_method: 'manual',
          // confirm: true,
        });

        return {
          id: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          amount: amount,
          currency: currency.toUpperCase(),
          status: paymentIntent.status,
          provider: 'stripe'
        };
      } else {
        // PayPal implementation
        const accessToken = await this.getPayPalAccessToken();
        const requestBody = {
          intent: 'CAPTURE',
          purchase_units: [{
            amount: {
              currency_code: currency.toUpperCase(),
              value: amount.toFixed(2)
            },
            description
          }],
          application_context: {
            brand_name: 'Free Money App',
            landing_page: 'LOGIN',
            user_action: 'PAY_NOW',
            return_url: `${process.env.BASE_URL}/payment/success`,
            cancel_url: `${process.env.BASE_URL}/payment/cancel`
          }
        };

        // Add metadata if provided
        if (metadata && Object.keys(metadata).length > 0) {
          requestBody.purchase_units[0].custom_id = JSON.stringify(metadata);
        }

        const response = await axios.post(
          `${this.provider.baseUrl}/v2/checkout/orders`,
          requestBody,
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );

        return {
          id: response.data.id,
          status: response.data.status,
          amount: amount,
          currency: currency.toUpperCase(),
          links: response.data.links,
          provider: 'paypal'
        };
      }
    } catch (error) {
      console.error('Error creating payment intent:', error);
      throw error;
    }
  }

  /**
   * Verify/confirm a payment
   * @param {string} paymentId - Payment ID from the provider
   * @param {Object} paymentData - Additional payment data (like payment method ID for Stripe)
   * @returns {Promise<Object>} Payment verification result
   */
  async verifyPayment(paymentId, paymentData = {}) {
    this.assertConfigured();
    try {
      if (this.provider instanceof Stripe) {
        // Stripe implementation
        const paymentIntent = await this.provider.paymentIntents.retrieve(paymentId);

        // If payment method ID provided, confirm the payment
        if (paymentData.payment_method_id) {
          const confirmedIntent = await this.provider.paymentIntents.confirm(
            paymentId,
            { payment_method: paymentData.payment_method_id }
          );
          return {
            id: confirmedIntent.id,
            status: confirmedIntent.status,
            amount_received: confirmedIntent.amount_received / 100, // Convert from cents
            amount: confirmedIntent.amount / 100,
            currency: confirmedIntent.currency.toUpperCase(),
            provider: 'stripe'
          };
        }

        return {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount_received: paymentIntent.amount_received / 100, // Convert from cents
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency.toUpperCase(),
          provider: 'stripe'
        };
      } else {
        // PayPal implementation
        const accessToken = await this.getPayPalAccessToken();
        const response = await axios.get(
          `${this.provider.baseUrl}/v2/checkout/orders/${paymentId}`,
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );

        // A CAPTURE-intent order has no `payments` object at all until it has
        // actually been captured — status alone (CREATED/APPROVED/COMPLETED) is what
        // distinguishes "buyer hasn't paid yet" from "buyer approved but we haven't
        // captured" from "money has actually moved." Reading captures[0] unguarded
        // here threw on every pending order instead of reporting its real status.
        const purchaseUnit = response.data.purchase_units[0];
        const paymentCapture = purchaseUnit.payments?.captures?.[0];

        return {
          id: response.data.id,
          status: response.data.status,
          amount: parseFloat(purchaseUnit.amount.value),
          currency: purchaseUnit.amount.currency_code,
          capture_id: paymentCapture ? paymentCapture.id : null,
          capture_status: paymentCapture ? paymentCapture.status : null,
          provider: 'paypal'
        };
      }
    } catch (error) {
      console.error('Error verifying payment:', error);
      throw error;
    }
  }

  /**
   * Actually collect the funds for a PayPal CAPTURE-intent order the buyer has
   * approved. Creating an order (createPaymentIntent) never moves money by itself —
   * without this explicit capture call, an approved order just sits there forever and
   * nothing is ever collected. Stripe payment intents don't need this: verifyPayment's
   * confirm step already finalizes the charge for that provider.
   * @param {string} orderId PayPal order ID from createPaymentIntent
   * @returns {Promise<Object>} capture result
   */
  async capturePayment(orderId) {
    this.assertConfigured();
    if (!(this.provider instanceof Stripe)) {
      const accessToken = await this.getPayPalAccessToken();
      const response = await axios.post(
        `${this.provider.baseUrl}/v2/checkout/orders/${orderId}/capture`,
        {},
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      const purchaseUnit = response.data.purchase_units[0];
      const capture = purchaseUnit.payments?.captures?.[0];

      return {
        id: response.data.id,
        status: response.data.status,
        capture_id: capture ? capture.id : null,
        capture_status: capture ? capture.status : null,
        amount: capture ? parseFloat(capture.amount.value) : null,
        currency: capture ? capture.amount.currency_code : null,
        provider: 'paypal'
      };
    }

    throw new Error('capturePayment is only implemented for PayPal — Stripe payment intents are captured via verifyPayment/confirm');
  }

  /**
   * Process a payout/withdrawal to a user's payment method
   * @param {number} amount - Amount in USD
   * @param {string} currency - Currency code
   * @param {string} destination - Destination account/payment method ID
   * @param {string} description - Description of the payout
   * @returns {Promise<Object>} Payout result
   */
  async processPayout(amount, currency, destination, description = '') {
    this.assertConfigured();
    try {
      if (this.provider instanceof Stripe) {
        // Stripe payout to bank account or debit card
        const payout = await this.provider.payouts.create({
          amount: Math.round(amount * 100), // Convert to cents
          currency: currency.toLowerCase(),
          destination,
          description
        });

        return {
          id: payout.id,
          amount: amount,
          currency: currency.toUpperCase(),
          status: payout.status,
          destination: payout.destination,
          provider: 'stripe'
        };
      } else {
        // PayPal payouts
        const accessToken = await this.getPayPalAccessToken();
        const requestBody = {
          sender_batch_header: {
            sender_batch_id: `batch_${Date.now()}`,
            email_subject: 'You have a payment'
          },
          items: [{
            amount: {
              value: amount.toFixed(2),
              currency: currency.toUpperCase()
            },
            note: description,
            receiver: destination  // Email or account ID
          }]
        };

        const response = await axios.post(
          `${this.provider.baseUrl}/v1/payments/payouts`,
          requestBody,
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );

        return {
          batch_id: response.data.batch_header.batch_id,
          batch_status: response.data.batch_header.batch_status,
          amount: amount,
          currency: currency.toUpperCase(),
          provider: 'paypal'
        };
      }
    } catch (error) {
      console.error('Error processing payout:', error);
      throw error;
    }
  }

  /**
   * Get PayPal access token
   * @returns {Promise<string>} Access token
   */
  async getPayPalAccessToken() {
    const auth = Buffer.from(
      `${this.provider.clientId}:${this.provider.clientSecret}`
    ).toString('base64');

    const response = await axios.post(
      `${this.provider.baseUrl}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${auth}`
        }
      }
    );

    return response.data.access_token;
  }
}

// Create and export singleton instance
const paymentService = new PaymentService();
module.exports = { PaymentService, paymentService };