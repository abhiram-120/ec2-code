const axios = require('axios');

const PAYPLUS_BASE_URL = process.env.PAYPLUS_BASE_URL || 'https://restapi.payplus.co.il/api/v1.0';
const PAYPLUS_API_KEY = process.env.PAYPLUS_API_KEY;
const PAYPLUS_SECRET_KEY = process.env.PAYPLUS_SECRET_KEY;

/**
 * Download a PayPlus invoice document (original or copy) for a given transaction
 * and stream it directly to the Express response.
 */
async function downloadFamilyInvoiceFromPayPlus({ transaction_uid, type = 'original', format = 'pdf', paymentId, res, payplusResponseData = null }) {
  try {
    // Validate type parameter
    if (!['original', 'copy'].includes(type)) {
      return res.status(400).json({
        status: 'error',
        message: 'Type must be either "original" or "copy"'
      });
    }

    // First, try to get invoice URLs directly from response data if available
    let downloadUrl = null;
    if (payplusResponseData) {
      try {
        const responseData = typeof payplusResponseData === 'string' 
          ? JSON.parse(payplusResponseData) 
          : payplusResponseData;
        
        // Handle double-encoded JSON strings
        const parsedData = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
        
        downloadUrl = type === 'original' 
          ? parsedData.invoice_original_url 
          : parsedData.invoice_copy_url;
      } catch (parseError) {
        console.error(`[downloadFamilyInvoiceFromPayPlus] Error parsing payplusResponseData:`, parseError);
      }
    }

    // If no URL in response data, call GetDocuments API
    if (!downloadUrl || downloadUrl.trim() === '') {
      
      // Get invoice documents from PayPlus
      const payplusUrl = `${PAYPLUS_BASE_URL}/Invoice/GetDocuments`;
      const requestData = {
        transaction_uid,
        filter: {}
      };

      const headers = {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': PAYPLUS_API_KEY,
        'secret-key': PAYPLUS_SECRET_KEY
      };

      const response = await axios.post(payplusUrl, requestData, {
        headers,
        timeout: 30000
      });

      if (
        response.status !== 200 ||
        !response.data ||
        !response.data.invoices ||
        response.data.invoices.length === 0
      ) {
        return res.status(404).json({
          status: 'error',
          message: 'No invoice documents found for this payment',
          payment_id: paymentId,
          transaction_uid
        });
      }

      // Find the first successful invoice
      const invoice = response.data.invoices.find((inv) => inv.status === 'success');
      if (!invoice) {
        return res.status(404).json({
          status: 'error',
          message: 'No successful invoice found for this payment',
          payment_id: paymentId,
          transaction_uid
        });
      }

      // Get the appropriate download URL
      downloadUrl = type === 'original' ? invoice.original_doc_url : invoice.copy_doc_url;

      if (!downloadUrl || downloadUrl.trim() === '') {
        return res.status(404).json({
          status: 'error',
          message: `${type} document URL not available for this invoice`,
          payment_id: paymentId,
          transaction_uid,
          available_types: {
            original: !!invoice.original_doc_url,
            copy: !!invoice.copy_doc_url
          }
        });
      }
    }

    // Download the document from PayPlus
    const documentResponse = await axios.get(downloadUrl, {
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'api-key': PAYPLUS_API_KEY,
        'secret-key': PAYPLUS_SECRET_KEY
      }
    });

    if (documentResponse.status !== 200) {
      throw new Error(`Failed to download document: HTTP ${documentResponse.status}`);
    }

    // Set response headers for file download
    const contentType = documentResponse.headers['content-type'] || 'application/pdf';
    const filename = `family_invoice_${transaction_uid}_${type}.${format}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // Stream the document to the client
    documentResponse.data.pipe(res);

    // Handle stream errors
    documentResponse.data.on('error', (error) => {
      console.error('Error streaming family invoice document:', error);
      if (!res.headersSent) {
        res.status(500).json({
          status: 'error',
          message: 'Error streaming invoice document',
          details: error.message
        });
      }
    });
  } catch (error) {
    console.error(`Error downloading family invoice for payment ${paymentId}:`, error);

    if (res.headersSent) {
      return;
    }

    if (error.response) {
      const statusCode = error.response.status;
      const errorData = error.response.data;

      if (statusCode === 404) {
        return res.status(404).json({
          status: 'error',
          message: 'Invoice document not found',
          payment_id: paymentId
        });
      }

      if (statusCode === 401 || statusCode === 403) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication failed with PayPlus API'
        });
      }

      return res.status(500).json({
        status: 'error',
        message: 'PayPlus API error during download',
        details: errorData || error.message,
        status_code: statusCode
      });
    }

    return res.status(500).json({
      status: 'error',
      message: 'Error downloading invoice',
      details: error.message
    });
  }
}

/**
 * Process PayPlus refund for a family payment transaction
 * @param {string} transactionUid - PayPlus transaction UID
 * @param {number} amount - Refund amount
 * @param {string} currency - Currency code
 * @param {string} reason - Refund reason
 * @returns {Promise<Object>} Refund result
 */
async function processFamilyPaymentRefund(transactionUid, amount, currency, reason) {
  try {
    const payplusUrl = `${PAYPLUS_BASE_URL}/Transactions/RefundByTransactionUid`;
    const refundData = {
      transaction_uid: transactionUid,
      amount: amount,
      currency_code: currency.toUpperCase(),
      reason: reason,
      send_customer_refund_email: true
    };
    
    const headers = {
      'accept': 'application/json',
      'content-type': 'application/json',
      'api-key': PAYPLUS_API_KEY,
      'secret-key': PAYPLUS_SECRET_KEY
    };
    
    console.log(`[processFamilyPaymentRefund] Processing refund for transaction ${transactionUid}:`, {
      amount,
      currency,
      reason: reason.substring(0, 50) + '...'
    });
    
    const response = await axios.post(payplusUrl, refundData, {
      headers,
      timeout: 30000
    });
    
    console.log(`[processFamilyPaymentRefund] PayPlus response status: ${response.status}`);
    
    if (response.status === 200 && response.data?.results?.status === 'success') {
      return {
        success: true,
        data: response.data,
        refundTransactionUid: response.data?.data?.transaction_uid || response.data?.results?.transaction_uid || `refund_${Date.now()}`
      };
    } else {
      return {
        success: false,
        error: response.data?.results?.description || 'PayPlus refund failed',
        payplusResponse: response.data
      };
    }
    
  } catch (error) {
    console.error(`[processFamilyPaymentRefund] Error processing refund:`, error);
    return {
      success: false,
      error: error.response?.data?.description || error.response?.data?.results?.description || error.message,
      payplusResponse: error.response?.data
    };
  }
}

/**
 * Download credit invoice for a refunded family payment transaction
 * @param {string} transactionUid - Original PayPlus transaction UID
 * @param {string} type - 'original' or 'copy'
 * @param {string} format - 'pdf' or 'html'
 * @param {number} paymentId - Family payment transaction ID
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
async function downloadFamilyCreditInvoice({ transaction_uid, type = 'original', format = 'pdf', paymentId, res }) {
  try {
    // Validate type parameter
    if (!['original', 'copy'].includes(type)) {
      return res.status(400).json({
        status: 'error',
        message: 'Type must be either "original" or "copy"'
      });
    }

    console.log(`[downloadFamilyCreditInvoice] Downloading credit invoice for payment ${paymentId}, transaction: ${transaction_uid}`);

    // Get invoice documents from PayPlus using the ORIGINAL transaction UID
    const payplusUrl = `${PAYPLUS_BASE_URL}/Invoice/GetDocuments`;
    const requestData = {
      transaction_uid: transaction_uid, // Use original payment transaction UID
      filter: {}
    };

    const headers = {
      'accept': 'application/json',
      'content-type': 'application/json',
      'api-key': PAYPLUS_API_KEY,
      'secret-key': PAYPLUS_SECRET_KEY
    };

    // Get invoice documents
    const response = await axios.post(payplusUrl, requestData, { 
      headers,
      timeout: 30000
    });

    if (response.status !== 200 || !response.data || !response.data.invoices || response.data.invoices.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No invoice documents found for this payment',
        payment_id: paymentId,
        transaction_uid: transaction_uid
      });
    }

    console.log(`[downloadFamilyCreditInvoice] Found ${response.data.invoices.length} invoice documents for transaction ${transaction_uid}`);

    // Filter for credit invoices and receipts
    const creditDocuments = response.data.invoices.filter(inv => 
      inv.status === 'success' && 
      (inv.type === 'Credit Invoice' || inv.type === 'Credit Receipt')
    );

    if (creditDocuments.length === 0) {
      // List available document types for debugging
      const availableTypes = response.data.invoices.map(inv => ({
        type: inv.type,
        status: inv.status,
        date: inv.date
      }));

      return res.status(404).json({
        status: 'error',
        message: 'No credit invoice or receipt found for this refunded payment',
        payment_id: paymentId,
        transaction_uid: transaction_uid,
        available_documents: availableTypes,
        note: 'Credit documents are only generated after a refund is processed'
      });
    }

    // Prioritize Credit Invoice over Credit Receipt
    let creditDocument = creditDocuments.find(doc => doc.type === 'Credit Invoice');
    if (!creditDocument) {
      creditDocument = creditDocuments.find(doc => doc.type === 'Credit Receipt');
    }

    console.log(`[downloadFamilyCreditInvoice] Using ${creditDocument.type} document dated ${creditDocument.date}`);

    // Get the appropriate download URL based on type
    const downloadUrl = type === 'original' 
      ? creditDocument.original_doc_url 
      : creditDocument.copy_doc_url;
    
    if (!downloadUrl) {
      return res.status(404).json({
        status: 'error',
        message: `${type} ${creditDocument.type.toLowerCase()} document URL not available`,
        payment_id: paymentId,
        transaction_uid: transaction_uid,
        document_type: creditDocument.type,
        available_types: {
          original: !!creditDocument.original_doc_url,
          copy: !!creditDocument.copy_doc_url
        }
      });
    }

    console.log(`[downloadFamilyCreditInvoice] Found ${type} ${creditDocument.type} document URL for payment ${paymentId}`);

    // Download the credit document from PayPlus
    const documentResponse = await axios.get(downloadUrl, {
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'api-key': PAYPLUS_API_KEY,
        'secret-key': PAYPLUS_SECRET_KEY
      }
    });

    if (documentResponse.status !== 200) {
      throw new Error(`Failed to download ${creditDocument.type}: HTTP ${documentResponse.status}`);
    }

    // Set response headers for file download
    const contentType = documentResponse.headers['content-type'] || 'application/pdf';
    const documentTypeSlug = creditDocument.type.toLowerCase().replace(/\s+/g, '_'); // "credit_invoice" or "credit_receipt"
    const filename = `family_${documentTypeSlug}_${transaction_uid}_${type}.${format}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    console.log(`[downloadFamilyCreditInvoice] Streaming ${creditDocument.type}: ${filename}`);

    // Stream the document to the client
    documentResponse.data.pipe(res);

    // Handle stream errors
    documentResponse.data.on('error', (error) => {
      console.error(`[downloadFamilyCreditInvoice] Error streaming ${creditDocument.type}:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          status: 'error',
          message: `Error streaming ${creditDocument.type} document`,
          details: error.message
        });
      }
    });
  } catch (error) {
    console.error(`[downloadFamilyCreditInvoice] Error downloading credit invoice for payment ${paymentId}:`, error);

    if (res.headersSent) {
      return;
    }

    if (error.response) {
      const statusCode = error.response.status;
      const errorData = error.response.data;

      if (statusCode === 404) {
        return res.status(404).json({
          status: 'error',
          message: 'Credit invoice document not found',
          payment_id: paymentId,
          details: 'The credit document may not have been generated yet, or the transaction UID is invalid'
        });
      }

      if (statusCode === 401 || statusCode === 403) {
        return res.status(401).json({
          status: 'error',
          message: 'Authentication failed with PayPlus API'
        });
      }

      return res.status(500).json({
        status: 'error',
        message: 'PayPlus API error during credit document download',
        details: errorData || error.message,
        status_code: statusCode
      });
    }

    return res.status(500).json({
      status: 'error',
      message: 'Error downloading credit document',
      details: error.message
    });
  }
}

/**
 * Check with PayPlus if a recurring payment still exists and is active (not cancelled).
 * Used to decide whether to show recurring-related UI (e.g. cancel recurring, lesson management) before refund.
 * @param {string} recurringPaymentUid - PayPlus recurring payment UID
 * @returns {Promise<{ exists: boolean }>} exists true if PayPlus returns the recurring and it is still active
 */
async function checkRecurringExistsAtPayPlus(recurringPaymentUid) {
  try {
    if (
      !recurringPaymentUid ||
      recurringPaymentUid === 'undefined' ||
      recurringPaymentUid === '' ||
      recurringPaymentUid === 'N/A'
    ) {
      return { exists: false };
    }

    const PAYPLUS_CONFIG = {
      apiKey: PAYPLUS_API_KEY || '',
      secretKey: PAYPLUS_SECRET_KEY || '',
      baseUrl: PAYPLUS_BASE_URL,
      terminalUid: process.env.PAYPLUS_TERMINAL_UID || '7aab6b6b-0ab9-42b2-b71c-37307667ced7'
    };

    const response = await axios.get(
      `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/${recurringPaymentUid}/ViewRecurring`,
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': PAYPLUS_CONFIG.apiKey,
          'secret-key': PAYPLUS_CONFIG.secretKey
        },
        params: {
          terminal_uid: PAYPLUS_CONFIG.terminalUid
        },
        timeout: 15000
      }
    );

    if (response.status === 200 && response.data) {
      const data = response.data.data || response.data;
      const status = (data.status || data.recurring_status || '').toLowerCase();
      const cancelled = status === 'cancelled' || status === 'canceled' || data.cancelled === true;
      return { exists: !cancelled };
    }
    return { exists: false };
  } catch (error) {
    if (error.response?.status === 404) {
      return { exists: false };
    }
    console.error(
      `[checkRecurringExistsAtPayPlus] Error checking recurring ${recurringPaymentUid}:`,
      error.response?.data || error.message
    );
    return { exists: false };
  }
}

/**
 * Cancel PayPlus recurring payment (shared helper for family payments)
 * @param {string} recurringPaymentUid
 * @returns {Promise<boolean>} success
 */
async function cancelFamilyRecurringPayment(recurringPaymentUid) {
  try {
    if (
      !recurringPaymentUid ||
      recurringPaymentUid === 'undefined' ||
      recurringPaymentUid === '' ||
      recurringPaymentUid === 'N/A'
    ) {
      return true; // Consider it successful if no UID
    }

    const PAYPLUS_CONFIG = {
      apiKey: PAYPLUS_API_KEY || '',
      secretKey: PAYPLUS_SECRET_KEY || '',
      baseUrl: PAYPLUS_BASE_URL,
      terminalUid: process.env.PAYPLUS_TERMINAL_UID || '7aab6b6b-0ab9-42b2-b71c-37307667ced7'
    };

    const response = await axios.post(
      `${PAYPLUS_CONFIG.baseUrl}/RecurringPayments/DeleteRecurring/${recurringPaymentUid}`,
      {
        terminal_uid: PAYPLUS_CONFIG.terminalUid,
        _method: 'DELETE'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': PAYPLUS_CONFIG.apiKey,
          'secret-key': PAYPLUS_CONFIG.secretKey
        },
        timeout: 30000
      }
    );

    if (response.status === 200 || response.status === 204) {
      return true;
    }
    return false;
  } catch (error) {
    // If recurring payment doesn't exist, consider it successful
    if (
      error.response?.status === 404 ||
      (typeof error.response?.data === 'string' &&
        (error.response.data.includes('not found') || error.response.data.includes('already cancelled')))
    ) {
      return true;
    }

    console.error(
      `[cancelFamilyRecurringPayment] Error cancelling PayPlus recurring payment ${recurringPaymentUid}:`,
      error
    );
    return false;
  }
}

module.exports = {
  downloadFamilyInvoiceFromPayPlus,
  processFamilyPaymentRefund,
  downloadFamilyCreditInvoice,
  cancelFamilyRecurringPayment,
  checkRecurringExistsAtPayPlus,
};