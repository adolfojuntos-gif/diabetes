# Salon booking: n8n + Square + Telnyx (no GoHighLevel)

- **Square** holds the calendar, each stylist's own service times and saved cards, and charges no-show fees.
- **Telnyx** sends and receives the texts.
- **n8n** runs everything with 2 workflows.

| File | What it does |
|---|---|
| `salon-A-ai-text-assistant-telnyx.json` | A client texts → the AI checks Square for open times. Returning clients with a saved card are booked by text. New clients get the Square booking link, where Square saves the card and shows the policy. When a client replies **C**, the AI marks the appointment "Confirmed" in Square (staff see it in the Square app). If the AI gets stuck, the manager gets a text and the AI stays quiet with that client for 12 hours. |
| `salon-B-square-texts-telnyx.json` | When a booking changes: confirmation to the client (online bookings) and a heads-up to the stylist. **Cancelled or no-show:** asks the client if they want another day (the AI rebooks them when they reply), and alerts the manager for late cancels and no-shows. Every hour: **2 days before**, a reminder plus "Reply C to confirm"; **1 day before and still not confirmed**, a nudge to the client and a heads-up to the manager to follow up or release the spot; **2 hours before**, a reminder; **after the visit**, a thank-you with a review link. |

## Setup

### 1. Square
1. **Appointments → Settings:**
   - Turn on online booking.
   - Turn on **require a card to book**.
   - Set your cancellation / no-show policy and fee.
   - Copy your booking page link.
2. **One version of each service per speed**, same price. For example, "Long Haircut 45 min" assigned only to Maria, and "Long Haircut 90 min" assigned only to Ana.
3. **Turn off Square's own text reminders**, so clients don't get two of everything.
4. **developer.squareup.com:**
   - Create an app and copy the Access token and Location ID.
   - Under **Webhooks**, add `https://YOUR-N8N-ADDRESS/webhook/square-events` for `booking.created` and `booking.updated`.
   - Copy the Signature key.

### 2. Telnyx
1. Buy or choose a phone number and attach it to a **Messaging Profile**.
2. On the Messaging Profile, set the inbound webhook URL to `https://YOUR-N8N-ADDRESS/webhook/telnyx-sms`.
3. Complete **10DLC registration** (brand + campaign) for the number. US carriers block or filter unregistered business texting.
4. Optional, but recommended: copy the **Public Key** (Keys & Credentials) into `telnyxPublicKey` in Settings, so n8n can confirm each message really came from Telnyx.
5. Telnyx handles STOP / HELP / START on its own. The AI ignores those words.

### 3. n8n
1. Import both files: **Create workflow → ⋯ → Import from File**.
2. Create the credentials:
   - **Header Auth** `Telnyx API (Bearer token)`: Name `Authorization`, Value `Bearer YOUR_TELNYX_API_KEY`
   - **Header Auth** `Square API (Bearer token)`: Name `Authorization`, Value `Bearer YOUR_SQUARE_TOKEN`
   - **Anthropic** (for the AI)
3. Fill in **Settings** in both workflows, with the same values in each: phones, links, Square IDs, stylists and services.
4. Test with Square's **Sandbox**. Then switch `squareBaseUrl` to `https://connect.squareup.com`, use your live token, and **Publish** both workflows.

## Costs (approximate; check current prices)
- **Telnyx:** about 0.4¢ per text plus carrier fees, about $1/month per number, and one-time and monthly 10DLC fees.
- **n8n:** self-hosted about $6–12/month for the server, or n8n Cloud Starter about $24/month.
- **AI:** a few dollars per salon per month.

## Notes
- Fees are only charged by someone at the salon, in the Square app. Nothing charges automatically.
- The AI never asks for card numbers. Cards are only entered on Square's booking page.
- The "AI stays quiet for 12 hours" pause only works while the workflow is **published** (active).
- These workflows were syntax-checked and their logic was tested with sample data, including Telnyx and Square signature checks. They haven't been run against live Square or Telnyx yet, so test in the Sandbox first.
