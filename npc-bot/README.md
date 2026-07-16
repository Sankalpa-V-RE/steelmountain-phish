# NPC Bot - Phishing Simulation Worker

This bot acts as the automated "human" reviewer for the Steel Mountain CTF challenge. It runs as a background process, polls a custom HTTP JSON Mail API for review request emails, parses verification codes and links, and uses Playwright (headless browser) to visit the link and attempt to log in using its corporate credentials.

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Install Playwright Browsers**:
   ```bash
   npx playwright install chromium
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the `npc-bot` directory with the following variables:
   ```env
   # Backend API Settings
   BACKEND_URL="http://localhost:3000"
   BOT_SECRET="super-secret-shared-bot-token"

   # Mail API Settings
   MAIL_API_BASE_URL="http://example.com"
   MAIL_API_SECRET="your-mail-api-secret"
   NPC_TEAM_NAME="team-alpha"

   # Database Settings
   DATABASE_URL="postgresql://user:password@host:port/db?sslmode=require"

   # Reviewer Credentials (matches database seeded values)
   REVIEWER_USERNAME="reviewer_bot"
   REVIEWER_PASSWORD="SecurePlaintextPassword123"

   # Polling Configuration
   POLL_INTERVAL_MS=30000
   ```

## Running the Bot

Run the script locally:
```bash
npm start
```

## How to Test Locally

1. Seed the database with the reviewer credentials (see backend folder's seed script).
2. The bot fetches emails from the custom Mail API endpoint (`/api/team/public/mail/all`). Ensure your CTF platform provides this endpoint.
3. The bot deduplicates emails by tracking `_id` in the `processed_emails` table.
4. Run `npm start` and watch the terminal output.

*Note: The Mail API currently returns the entire mailbox on every call rather than only new messages. This is handled gracefully via DB deduplication, but may cause payload growth over a long-running CTF event. This is flagged as a possible future improvement.*
