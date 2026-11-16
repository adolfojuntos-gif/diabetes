# Salon booking: simple version

**Square** holds the calendar, saves cards and charges no-show fees.
**GoHighLevel** sends all the texts.
**n8n** is the bridge between them, with just 2 workflows.

## The 2 n8n workflows

| File | What it does |
|---|---|
| `salon-A-ai-text-assistant.json` | A client texts → the AI checks Square for open times → **returning client with a saved card:** the AI books it. **New client:** the AI sends your Square booking link, where Square saves their card and shows your policy. |
| `salon-B-square-to-gohighlevel.json` | Keeps GoHighLevel in sync with Square. It adds a tag when a booking is made, cancelled, cancelled late or marked no-show, and every hour it adds the reminder tags. |

## Setup (about 30 minutes)

### 1. Square
1. **Appointments → Settings:**
   - Turn on **online booking**.
   - Turn on **"Require a card to book"** (no-show protection).
   - Set your **cancellation policy and fee**.
   - Copy your **booking page link**.
2. **One version of each service per speed:**
   - Example: "Long Haircut 45 min" assigned only to Maria, and "Long Haircut 90 min" assigned only to Ana.
   - Give them the same price.
3. **Turn off Square's text reminders**, so clients don't get every reminder twice.
4. **developer.squareup.com:**
   - Create an app and copy the **Access token** and **Location ID**.
   - Under **Webhooks**, add `https://theseam.app.n8n.cloud/webhook/square-events` for `booking.created` and `booking.updated`.
   - Copy the **Signature key**.

### 2. n8n
1. Import both files: **Create workflow → ⋯ → Import from File**.
2. Create the credentials:
   - **Header Auth** `Square API (Bearer token)`: Name `Authorization`, Value `Bearer YOUR_SQUARE_TOKEN`
   - **Header Auth** `GoHighLevel API (Bearer token)`: Name `Authorization`, Value `Bearer YOUR_GHL_TOKEN`
   - **Anthropic**
3. Fill in the **Settings** node in each workflow, with the same settings in both.

### 3. GoHighLevel
1. Under **Settings → Custom Fields**, add 4 text fields: `appt_time`, `appt_stylist`, `appt_service`, `booked_via`.
2. Under **Automation → Workflows**, build these 5:

| # | Trigger | Actions |
|---|---|---|
| 1 | **Customer Replied** (SMS), only if the contact does **not** have the tag `human-takeover` | **Webhook** POST to `https://theseam.app.n8n.cloud/webhook/ghl-sms`. Add Custom Data: `message` = `{{message.body}}`, `contact_id` = `{{contact.id}}`, `phone` = `{{contact.phone}}` |
| 2 | Tag added `needs-human` | Notify the manager → add tag `human-takeover` (pauses the AI) → wait 12 hours → remove both tags |
| 3 | Tag added `sq-booked` or `sq-cancelled` | If `booked_via` is `square`, text the confirmation. Notify the stylist. Remove the tag |
| 4 | Tag added `sq-remind-48h` / `sq-remind-2h` / `sq-completed` | Send the matching text (2 days before / 2 hours before / thank you + review request). Remove the tag |
| 5 | Tag added `sq-late-cancel` or `sq-no-show` | Text the manager: "{{contact.name}} missed {{contact.appt_time}}. To charge the fee, open the appointment in Square." Remove the tag |

### 4. Test
- Test everything with Square's **Sandbox** first.
- Then switch `squareBaseUrl` to `https://connect.squareup.com` and use your live token.
- Publish both workflows.

## Notes
- Fees are only charged when someone at the salon charges them in Square. Nothing charges automatically.
- The AI never asks for card numbers. Cards are only entered on Square's own booking page.
- These workflows were syntax-checked and their logic was tested with sample data. They haven't been run against live Square or GoHighLevel yet, so test in the Sandbox first.
