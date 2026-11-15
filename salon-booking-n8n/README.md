# Salon Booking Autopilot (n8n + Square)

Five n8n workflows that turn Square Appointments into a text-message booking system:

| File | What it does, in simple words |
|---|---|
| `1-ai-text-booking-assistant.json` | A client texts the salon. The AI checks the real Square calendar, offers open times, and books the one they pick. It only books if the client has a card on file. |
| `2-save-card-page.json` | The secure web page where the client saves a card (inside Square's own card box) and agrees to the policy. The agreement is logged in Google Sheets. |
| `3-reminders.json` | Runs every hour and texts clients 2 days before, 2 hours before, and after the visit (asking for a review). |
| `4-square-booking-events.json` | Square tells n8n about every booking change. New booking or on-time cancel: the stylist gets a text. Late cancel or no-show: the manager gets a "Charge or Waive?" link. |
| `5-fee-approve-or-waive.json` | The page the manager opens from that link. **Charge** charges the saved card and texts a receipt. **Waive** charges nothing. Both are logged. |

`explainer.html` is a one-page, plain-language explanation to show salon owners.

## How "each stylist has their own time" works

Square gives each service variation one duration. Make **one variation per speed** and assign it only to the stylists who work at that speed:

- `Long Haircut – 45 min`, assigned to Maria
- `Long Haircut – 90 min`, assigned to Ana

Use the same price for both, and use the same client-facing name if you like. Then put the IDs in the `services` list in workflow 1's **Config** node. The AI always picks the variation that belongs to the chosen stylist.

## Setup checklist

1. **Square** (start in the Sandbox)
   - In the Square Developer Dashboard, create an app and copy the **Access token**, **Application ID** and **Location ID**.
   - Create the team members and the service variations for each speed (see above). Copy the team member IDs and variation IDs.
   - Making bookings through the API usually needs **Appointments Plus or Premium**. Check Square's current docs for your plan.
   - Under Webhooks, add a subscription to `booking.created` and `booking.updated` pointing to `https://YOUR-N8N/webhook/square-events`. Copy the **Signature key**.
   - Turn off Square's own text reminders so clients don't get two of each.
2. **n8n**
   - Set the environment variable `NODE_FUNCTION_ALLOW_BUILTIN=crypto`. The Code nodes use it for signed links and Square signature checks.
   - Create credentials:
     - **Header Auth** named `Square API (Bearer token)`, with name `Authorization` and value `Bearer YOUR_SQUARE_ACCESS_TOKEN`
     - **Twilio**
     - **Anthropic**
     - **Google Sheets**
   - Import all 5 JSON files and select the credentials on any node that shows a warning.
   - Open the **Config** node in each workflow and fill in your details. `linkSecret` must be the **same** in every workflow.
3. **Twilio**: set the salon number's "A message comes in" webhook to `https://YOUR-N8N/webhook/salon-sms` (HTTP POST). In the US, register the number for A2P 10DLC.
4. **Google Sheets**: create a sheet with two tabs, `Consent` and `Fees`, each with a header row:
   - `Consent`: `timestamp, customer_id, customer_name, phone, card, agreed_policy, ip_address, device`
   - `Fees`: `timestamp, booking_id, type, decision, amount, payment_id, reason`
5. Activate the workflows and test end to end in the Square Sandbox before going live. To go live, change `squareBaseUrl` to `https://connect.squareup.com` and use your production token and IDs.

## Notes

- The AI's conversation memory is kept in n8n's memory and resets if n8n restarts. For production, swap the memory node for Postgres or Redis chat memory.
- The card rule is enforced in two places: the AI is instructed not to book without a card, and the booking tool is blocked when the client has no card on file.
- Fees are never charged automatically. Money moves only when the manager presses **Charge** on the decision page. The payment uses a fixed idempotency key per booking, so a double tap can't charge twice.
- These workflows were syntax-checked and their logic was tested with sample data. They have **not** yet been run against a live n8n instance or the Square API, so test in the Sandbox first.
