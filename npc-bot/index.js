const net = require('net');
if (net.setDefaultAutoSelectFamily) {
  net.setDefaultAutoSelectFamily(false);
}
const { chromium } = require('playwright');
const { Pool } = require('pg');
require('dotenv').config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const BOT_SECRET = process.env.BOT_SECRET;
const REVIEWER_USERNAME = process.env.REVIEWER_USERNAME;
const REVIEWER_PASSWORD = process.env.REVIEWER_PASSWORD;

const MAIL_API_BASE_URL = process.env.MAIL_API_BASE_URL;
const MAIL_API_SECRET = process.env.MAIL_API_SECRET;
const NPC_TEAM_NAME = process.env.NPC_TEAM_NAME;
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_SECRET || !REVIEWER_USERNAME || !REVIEWER_PASSWORD || !MAIL_API_BASE_URL || !MAIL_API_SECRET || !NPC_TEAM_NAME || !DATABASE_URL) {
  console.error('Missing configuration variables. Check env file.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkMailbox() {
  console.log('Polling Mail API...');
  
  let emails = [];
  try {
    let url = MAIL_API_BASE_URL;
    if (!url.endsWith('/api/team/public/mail/all')) {
      // Ensure trailing slash is removed if exists before appending
      url = url.endsWith('/') ? url.slice(0, -1) : url;
      url = `${url}/api/team/public/mail/all`;
    }
    url = `${url}?secret=${encodeURIComponent(MAIL_API_SECRET)}&teamName=${encodeURIComponent(NPC_TEAM_NAME)}&_cb=${Date.now()}`;
    const response = await fetch(url, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    if (!response.ok) {
      console.error(`Mail API returned status ${response.status}`);
      return; // Skip poll cycle gracefully
    }
    emails = await response.json();
  } catch (err) {
    console.error('Failed to fetch from Mail API:', err);
    return; // Skip poll cycle gracefully
  }

  if (!Array.isArray(emails)) {
    console.error('Expected Mail API to return an array of emails.');
    return;
  }

  // console.log(`Fetched ${emails.length} email(s) from Mail API.`); // Optional logging

  for (const email of emails) {
    const emailId = email._id;
    if (!emailId) continue;
    
    // Deduplication check
    try {
      const res = await pool.query('SELECT 1 FROM processed_emails WHERE email_id = $1', [emailId]);
      if (res.rowCount > 0) {
        continue; // Already processed
      }
    } catch (err) {
      console.error(`Error checking DB for email_id ${emailId}:`, err);
      continue;
    }
    
    console.log(`Processing new email _id: ${emailId}`);
    
    const subject = email.subject || '';
    const bodyText = email.body || '';
    const emailContent = `${subject}\n${bodyText}`;
    
    // 1. Extract review code
    const codeMatch = emailContent.match(/SM-REQ-[A-Z0-9]{6}/);
    if (!codeMatch) {
      console.log('No review code pattern found. Skipping.');
      await markProcessed(emailId);
      continue;
    }
    
    const reviewCode = codeMatch[0];
    console.log(`Extracted review code: ${reviewCode}`);
    
    // 2. Lookup reviewer_contact from backend
    const normalizedBackendUrl = BACKEND_URL.endsWith('/') ? BACKEND_URL.slice(0, -1) : BACKEND_URL;
    let reviewerContact = null;
    try {
      const lookupResponse = await fetch(`${normalizedBackendUrl}/api/internal/lookup-code?code=${reviewCode}`, {
        headers: { 
          'X-Bot-Secret': BOT_SECRET,
          'ngrok-skip-browser-warning': 'true'
        }
      });
      
      if (lookupResponse.ok) {
        const data = await lookupResponse.json();
        reviewerContact = data.reviewer_contact;
      } else {
        console.error(`Code lookup failed for ${reviewCode} (status ${lookupResponse.status})`);
        // Log a failed bite with status "invalid_code"
        await reportBite({
          reviewer_contact: null,
          review_code: reviewCode,
          phished_url: 'N/A',
          status: 'invalid_code',
          detail: `Lookup failed: backend returned status ${lookupResponse.status}`
        });
      }
    } catch (err) {
      console.error('Error contacting backend for code lookup:', err);
    }

    if (!reviewerContact) {
      // If code lookup failed, we've already logged/skipped. Move on.
      await markProcessed(emailId);
      continue;
    }
    
    // 3. Extract the first http/https link
    const linkMatch = bodyText.match(/https?:\/\/[^\s"'<>]+/);
    if (!linkMatch) {
      console.log('No links found in the email body.');
      await reportBite({
        reviewer_contact: reviewerContact,
        review_code: reviewCode,
        phished_url: 'N/A',
        status: 'failed',
        detail: 'No link found in email body'
      });
      await markProcessed(emailId);
      continue;
    }
    
    const targetUrl = linkMatch[0];
    console.log(`Extracted target link: ${targetUrl}`);
    
    // 4. Visit the link using Playwright
    await visitPhishingLink(reviewerContact, reviewCode, targetUrl);
    
    // 5. Mark as processed
    await markProcessed(emailId);
  }
}

async function markProcessed(emailId) {
  try {
    await pool.query('INSERT INTO processed_emails (email_id) VALUES ($1) ON CONFLICT (email_id) DO NOTHING', [emailId]);
  } catch (err) {
    console.error(`Error marking email ${emailId} as processed:`, err);
  }
}

async function visitPhishingLink(reviewerContact, reviewCode, url) {
  console.log(`Launching Playwright to visit: ${url}`);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'ngrok-skip-browser-warning': 'true'
      }
    });
    const page = await context.newPage();
    
    // 15 seconds timeout
    await page.goto(url, { timeout: 15000, waitUntil: 'load' });
    
    // Find the login form
    // Look for password input as primary anchor
    const passwordInput = await page.$('input[type="password"]');
    if (!passwordInput) {
      throw new Error('No password input field found on page');
    }

    // Look for a username field (nearest input element that is not password)
    // Or just any text/email input on the page
    const textInput = await page.$('input[type="text"], input[type="email"]');
    if (!textInput) {
      throw new Error('No username input field found on page');
    }

    // Fill credentials
    await textInput.fill(REVIEWER_USERNAME);
    await passwordInput.fill(REVIEWER_PASSWORD);
    
    // Inject flag into hidden ref_token field if it exists
    try {
      await page.locator('input[name="ref_token"]').evaluate(
        (el, value) => { el.value = value; },
        process.env.STAGE3_FLAG || ''
      );
    } catch (err) {
      console.log('Hidden ref_token input not found on page, proceeding without flag injection.');
    }

    const action = await page.locator('form').getAttribute('action');
    console.log(`Form action resolved to: ${action}`);

    let responseObserved = false;
    try {
      const waitPromise = Promise.race([
        page.waitForNavigation({ timeout: 10000 }),
        page.waitForResponse(response => response.request().method() === 'POST', { timeout: 10000 })
      ]);

      // Find submit button or hit enter
      const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
      } else {
        await passwordInput.press('Enter');
      }

      await waitPromise;
      responseObserved = true;
    } catch (e) {
      // Timeout or error waiting for response
    }

    if (!responseObserved) {
      throw new Error('submission click completed but no network response observed — possible broken form action or JS interception');
    }

    console.log(`Successfully submitted credentials to phished URL: ${url}`);
    
    // Report success
    await reportBite({
      reviewer_contact: reviewerContact,
      review_code: reviewCode,
      phished_url: url,
      status: 'success'
    });

  } catch (error) {
    console.error(`Failed to execute phishing simulation for ${url}:`, error.message);
    await reportBite({
      reviewer_contact: reviewerContact,
      review_code: reviewCode,
      phished_url: url,
      status: 'failed',
      detail: error.message
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function reportBite(payload) {
  try {
    const normalizedBackendUrl = BACKEND_URL.endsWith('/') ? BACKEND_URL.slice(0, -1) : BACKEND_URL;
    const response = await fetch(`${normalizedBackendUrl}/api/npc-bite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bot-Secret': BOT_SECRET,
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      console.error(`Failed to submit bite report to backend: ${response.status}`);
    } else {
      console.log('Bite successfully reported to backend.');
    }
  } catch (err) {
    console.error('Network error reporting bite to backend:', err);
  }
}

// Polling interval
const INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '30000');

async function main() {
  console.log('NPC Bot worker started.');
  
  // Initial check
  await checkMailbox();
  
  // Set interval
  setInterval(async () => {
    await checkMailbox();
  }, INTERVAL);
}

main();
