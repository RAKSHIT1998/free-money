// Payment service for handling real fiat currency transactions
// Supports multiple payment providers (Stripe, PayPal, etc.)

const Stripe = require('stripe');
const axios = require('axios');

class PaymentService {
  constructor() {
    this.provider = this.initializePaymentProvider();
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

        // Check if payment is completed
        const purchaseUnit = response.data.purchase_units[0];
        const paymentCapture = purchaseUnit.payments.captures[0];

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
   * Process a payout/withdrawal to a user's payment method
   * @param {number} amount - Amount in USD
   * @param {string} currency - Currency code
   * @param {string} destination - Destination account/payment method ID
   * @param {string} description - Description of the payout
   * @returns {Promise<Object>} Payout result
   */
  async processPayout(amount, currency, destination, description = '') {
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