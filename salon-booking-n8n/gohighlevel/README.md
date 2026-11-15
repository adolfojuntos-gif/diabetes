# GoHighLevel edition (Option 1)

**GoHighLevel** handles what clients see: texting, contacts, reminders, reviews and staff alerts.
**Square** holds the truth: the calendar, each stylist's own service times, saved cards and payments.
**n8n** is the bridge between them. It tells GoHighLevel what happened by **adding tags** to the contact, and each tag starts a GoHighLevel workflow.

## n8n workflows in this folder

| File | What it does |
|---|---|
| `ghl-0-one-click-setup.json` | Run once per salon. It creates all the contact fields and tags in GoHighLevel. |
| `ghl-1-ai-text-booking-assistant.json` | GoHighLevel forwards each client text here. The AI checks Square, books in Square, and replies through GoHighLevel. It adds `needs-card` or `needs-human` when needed. |
| `ghl-2-save-card-page.json` | The secure card page. When a card is saved, it adds the tag `card-on-file`, fills in `policy_agreed_at`, and adds a consent note to the contact. |
| `ghl-3-reminder-tags.json` | Runs every hour and adds `sq-remind-48h`, `sq-remind-2h` or `sq-completed` at the right time. |
| `ghl-4-square-events.json` | Square booking changes → adds `sq-booked`, `sq-cancelled`, `sq-late-cancel` or `sq-no-show`, and fills in `fee_link` and `fee_amount`. |
| `ghl-5-fee-charge-or-waive.json` | The manager's Charge/Waive page. Afterwards it adds `fee-charged` or `fee-waived` and a note to the contact. |

Twilio isn't needed here, because GoHighLevel's own phone number does the texting.

## n8n credentials
- **Header Auth** named `GoHighLevel API (Bearer token)`: name `Authorization`, value `Bearer YOUR_PRIVATE_INTEGRATION_TOKEN`. To get the token, go to the GoHighLevel sub-account, then **Settings → Private Integrations**, and allow access to contacts, conversations, messages, custom fields, tags and locations.
- **Header Auth** named `Square API (Bearer token)`: `Authorization` / `Bearer YOUR_SQUARE_ACCESS_TOKEN`
- **Anthropic**
- n8n setting: `NODE_FUNCTION_ALLOW_BUILTIN=crypto`
- Fill in **Config** in each workflow. `linkSecret` must be the same in all of them, and `ghlLocationId` is the sub-account's Location ID.

## Workflows to build in GoHighLevel (Automation → Workflows)

GoHighLevel doesn't let outside tools create workflows, so build these in its editor. Once the first salon is done, save a **Snapshot** to copy them all to the next salon.

1. **Text in → AI assistant**
   - Trigger: *Customer Replied*, channel SMS.
   - Filter: the contact does **not** have the tag `human-takeover`.
   - Action: *Webhook* (the standard one), POST to `https://YOUR-N8N/webhook/ghl-sms`, with Custom Data:
     - `message` = `{{message.body}}`
     - `contact_id` = `{{contact.id}}`
     - `phone` = `{{contact.phone}}`
     - `tags` = `{{contact.tags}}`
2. **AI needs a person**
   - Trigger: tag added `needs-human`.
   - Actions:
     - Internal notification (SMS) to the manager
     - Assign the conversation to the manager
     - Add tag `human-takeover`
     - Wait 12 hours, then remove `human-takeover` and `needs-human`
3. **Booking confirmed**
   - Trigger: tag added `sq-booked`.
   - If/Else: if `booked_via` is not `ai`, send SMS "You're booked! {{contact.appt_time}} with {{contact.appt_stylist}}…"
   - Actions:
     - Internal notification to the stylist
     - Remove `sq-booked`
4. **No card yet**
   - Trigger: tag added `needs-card`.
   - Actions:
     - Wait 2 hours
     - If the contact doesn't have `card-on-file`, send SMS with `{{contact.card_link}}`
     - Remove `needs-card`
5. **Reminder: 2 days before**
   - Trigger: tag added `sq-remind-48h`.
   - Actions: send SMS, then remove the tag.
6. **Reminder: 2 hours before**
   - Trigger: tag added `sq-remind-2h`.
   - Actions: send SMS, then remove the tag.
7. **After the visit**
   - Trigger: tag added `sq-completed`.
   - Actions:
     - Wait 2 hours, then *Send Review Request*
     - Wait 5 weeks, then send SMS "Time for a refresh? Reply BOOK"
     - Remove the tag
8. **Cancelled in time**
   - Trigger: tag added `sq-cancelled`.
   - Actions:
     - Notify the stylist
     - Optional: text contacts tagged `waitlist`
     - Remove the tag
9. **Late cancel or no-show**
   - Trigger: tag added `sq-late-cancel` or `sq-no-show`.
   - Actions:
     - Internal SMS to the manager: "{{contact.name}} missed {{contact.appt_time}}. Charge {{contact.fee_amount}} or waive? {{contact.fee_link}}"
     - Create an opportunity in the **No-shows & late cancels** pipeline, at the stage "Waiting for decision"
   - For no-shows only:
     - *Math Operation* to add 1 to `no_show_count`
     - If `no_show_count` ≥ 2, add tag `prepay-required`
   - Remove the trigger tag.
10. **Fee decided**
    - Trigger: tag added `fee-charged` or `fee-waived`.
    - If charged:
      - Send SMS receipt with `{{contact.fee_amount}}`
      - Move the opportunity to "Charged"
    - If waived: move the opportunity to "Waived".
    - Remove the tags.

Create the pipeline **No-shows & late cancels** (stages: Waiting for decision, Charged, Waived) under Opportunities → Pipelines.

## Notes
- Contacts are matched between Square and GoHighLevel **by phone number**.
- Updating contact fields uses the field **key** (for example `appt_time`). If GoHighLevel rejects a key, use the field ID instead.
- These workflows were syntax-checked and their logic was tested with sample data. They haven't been run against live n8n, GoHighLevel or Square yet. Test with Square's Sandbox first.
