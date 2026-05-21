# WhatsApp AI Bot (FreshBites)

A friendly WhatsApp customer service bot for a food business. It answers common questions, shows the menu, takes simple orders, and can route customers to a real staff member. It is built to be reliable even when the AI service is unavailable.

## What this bot does (plain English)

- Greets new customers and shows quick action buttons.
- Sends the full menu on request.
- Detects simple orders (example: "2 suya") and calculates totals.
- Asks customers to choose variants (beef vs chicken, goat vs catfish, beer vs malt vs energy drink) before confirming price.
- Provides delivery info, pricing packages, and contact/support without calling the AI.
- Lets customers ask for a real person and sends support contact details.

## Why this is useful for a business

- Answers customers fast, 24/7.
- Keeps prices and menu accurate because they are hard-coded.
- Still works when the AI quota is exhausted or the AI is down.
- Easy to update in one place for future menu or pricing changes.

## How it works (simple overview)

1. WhatsApp sends a message to your webhook.
2. The bot checks for:
	- Menu request
	- Order detection
	- Delivery, pricing, or support questions
	- Human handoff requests
3. Only if none of the above match, it calls the AI model for general FAQs.
4. AI responses are forced into a strict JSON format and then filtered for safety.

## Key files

- index.js - main server and webhook handler
- orderLogic.js - menu data, pricing, and order detection logic
- scripts/mock_flow.js - local test for order detection
- scripts/mock_llm_guard.js - local test for the AI response guard

## Setup

### 1) Install dependencies

```bash
npm install
```

### 2) Create your .env file

Create a .env file in the project root with these variables:

```env
VERIFY_TOKEN=your_verify_token
WHATSAPP_TOKEN=your_whatsapp_token
PHONE_NUMBER_ID=your_phone_number_id
OPENAI_API_KEY=your_openai_api_key
SESSION_SECRET=your_random_session_secret
REDIS_URL=redis://localhost:6379
# Optional, for webhook signature validation
WHATSAPP_APP_SECRET=your_whatsapp_app_secret
```

### 3) Run the bot locally

```bash
npm start
```

## Deployment notes (Render or similar)

- Make sure SESSION_SECRET is set in your hosting environment.
- Set WHATSAPP_APP_SECRET to enable webhook signature validation.
- If the AI quota is exceeded, the bot still responds with delivery, pricing, and support info.

## Recent updates included in this repo

- Added variant-aware ordering (beef/chicken, goat/catfish, beer/malt/energy drink).
- Built a safe AI guard that only allows JSON responses.
- Routed delivery, pricing, and support questions without the AI.
- Added human handoff keywords (human, agent, staff, customer care, etc.).
- Split menu/order logic into its own module for easier maintenance.

## How to update the menu later

Edit orderLogic.js and update:

- MENU items
- Variants and prices

This keeps the AI from inventing prices and protects accuracy.

## Quick tests

```bash
node scripts/mock_flow.js
node scripts/mock_llm_guard.js
```

## License

ISC
