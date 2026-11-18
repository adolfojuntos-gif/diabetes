"""Simple edition: 2 n8n workflows. Square handles cards + fees, GoHighLevel handles texting."""
import json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_OUT = sys.argv[1]
os.makedirs(REAL_OUT, exist_ok=True)
src = open(os.path.join(HERE, "gen.py")).read()
head = src.split("# =====================================================================\n# 1. AI TEXT")[0]
sys.argv = [sys.argv[0], tempfile.mkdtemp()]
exec(head)
OUT = REAL_OUT

GHL_CRED = {"httpHeaderAuth": {"id": "REPLACE_GHL_CRED", "name": "GoHighLevel API (Bearer token)"}}


def ghl(wf, name, pos, method, path_expr, body_expr, version="2021-07-28"):
    return wf.add(name, "n8n-nodes-base.httpRequest", 4.2, pos, {
        "method": method, "url": "={{ 'https://services.leadconnectorhq.com' + " + path_expr + " }}",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendHeaders": True, "headerParameters": {"parameters": [
            {"name": "Version", "value": version}, {"name": "Accept", "value": "application/json"}]},
        "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify(" + body_expr + ") }}",
        "options": {}}, credentials=GHL_CRED, onError="continueRegularOutput")


SETTINGS = r"""// ================= YOUR SALON SETTINGS =================
// Fill this in once. Copy the SAME settings into the other workflow.
const SETTINGS = {
  salonName: 'Your Salon Name',
  timezone: 'America/Chicago',
  bookingLink: 'https://book.squareup.com/appointments/YOUR-LINK',  // your Square online booking page

  // Square (use the Sandbox address while testing; live = https://connect.squareup.com)
  squareBaseUrl: 'https://connect.squareupsandbox.com',
  squareVersion: '2025-01-23',
  locationId: 'YOUR_SQUARE_LOCATION_ID',
  squareWebhookSignatureKey: 'YOUR_SQUARE_WEBHOOK_SIGNATURE_KEY',
  squareWebhookUrl: 'https://adolfo12.app.n8n.cloud/webhook/square-events',

  // GoHighLevel
  ghlLocationId: 'YOUR_GHL_LOCATION_ID',

  lateCancelHours: 24,
  policyText: 'Free to cancel or change up to 24 hours before. Late cancellations and no-shows may be charged a fee to the card you saved when booking.',

  // Each stylist has their OWN time for each service.
  // In Square, make one version of the service per speed (same name and price for clients).
  stylists: [
    { name: 'Maria', team_member_id: 'TEAM_MEMBER_ID_MARIA' },
    { name: 'Ana',   team_member_id: 'TEAM_MEMBER_ID_ANA' },
  ],
  services: [
    { name: 'Long Haircut', price: '$65', options: [
      { stylist: 'Maria', minutes: 45, team_member_id: 'TEAM_MEMBER_ID_MARIA', service_variation_id: 'VARIATION_ID_LONG_CUT_45' },
      { stylist: 'Ana',   minutes: 90, team_member_id: 'TEAM_MEMBER_ID_ANA',   service_variation_id: 'VARIATION_ID_LONG_CUT_90' },
    ]},
    { name: 'Short Haircut', price: '$40', options: [
      { stylist: 'Maria', minutes: 30, team_member_id: 'TEAM_MEMBER_ID_MARIA', service_variation_id: 'VARIATION_ID_SHORT_CUT_30' },
      { stylist: 'Ana',   minutes: 45, team_member_id: 'TEAM_MEMBER_ID_ANA',   service_variation_id: 'VARIATION_ID_SHORT_CUT_45' },
    ]},
  ],
};
// ========================================================

"""

# =====================================================================
# A. TEXT ASSISTANT
# =====================================================================
wf = WF("Salon A - AI Text Assistant")
wf.note("## A. AI Text Assistant\n\n**In simple words:** a client texts the salon's GoHighLevel number. The AI looks at the real Square calendar and offers open times.\n\n- **Client already has a card saved:** the AI books it in Square.\n- **New client:** the AI sends the Square booking link. Square saves their card and shows the policy.\n\nThe AI answers through GoHighLevel, so every chat is in your GoHighLevel inbox.\n\n**To set up:** fill in **Settings**, then pick your credentials on the orange nodes.",
        [-60, -420], w=640, h=340, color=4)
webhook(wf, "Text from GoHighLevel", [0, 0], "POST", "ghl-sms", respond="onReceived")
code(wf, "Settings", [220, 0], SETTINGS + r"""const p = $input.first().json.body || {};
const cd = p.customData || {};
const msg = cd.message || (p.message && p.message.body) || p.message || '';
return [{ json: { ...SETTINGS,
  contactId: cd.contact_id || p.contact_id || p.contactId || '',
  phone: cd.phone || p.phone || '',
  name: [p.first_name, p.last_name].filter(Boolean).join(' '),
  message: String(msg).trim() } }];""")
CFG2 = "$('Settings').first().json"
if_node(wf, "Is There a Message?", [440, 0], "={{ $json.message && $json.contactId && $json.phone ? 'yes' : '' }}", "string", "notEmpty")
# reuse square() helper but with the Settings node name
def sq(name, pos, method, path, body=None, query=None, tool=None):
    n = square(wf, name, pos, method, path, body, query, tool)
    node = wf.nodes[-1]
    s = json.dumps(node["parameters"]).replace("$('Config')", "$('Settings')")
    node["parameters"] = json.loads(s)
    return n
sq("Find Client in Square", [660, 0], "POST", "'/v2/customers/search'",
   "{ limit: 1, query: { filter: { phone_number: { exact: $json.phone } } } }")
code(wf, "Client Info", [880, 0], r"""const s = $('Settings').first().json;
const c = ($input.first().json.customers || [])[0];
return [{ json: { customerId: c ? c.id : '', known: !!c } }];""")
if_node(wf, "Known Client?", [1100, 0], "={{ $json.known }}", "boolean", "true")
sq("Check Saved Card", [1320, -80], "GET", "'/v2/cards'", query=[("customer_id", "={{ $json.customerId }}")])
code(wf, "Prepare the AI", [1540, 0], r"""const s = $('Settings').first().json;
const info = $('Client Info').first().json;
const cards = info.known ? (($input.first().json.cards || []).filter((c) => c.enabled !== false)) : [];
const canBook = info.known && cards.length > 0;

const now = new Date();
const nowText = now.toLocaleString('en-US', { timeZone: s.timezone, dateStyle: 'full', timeStyle: 'short' });
const off = (now.toLocaleString('en-US', { timeZone: s.timezone, timeZoneName: 'longOffset' }).match(/GMT([+-]\d{2}:\d{2})/) || [])[1] || '+00:00';
const menu = s.services.map((sv) => `- ${sv.name} (${sv.price}):\n` + sv.options.map((o) =>
  `    ${o.stylist}: ${o.minutes} min -> team_member_id=${o.team_member_id}, service_variation_id=${o.service_variation_id}`).join('\n')).join('\n');

const prompt = `You are the friendly text-message assistant for ${s.salonName}. Reply in 1-3 short sentences, plain text.

NOW: ${nowText} (${s.timezone}, UTC offset ${off}). Send times to tools as ISO 8601 with this offset, e.g. 2026-11-20T14:00:00${off}.
CLIENT: ${s.name || 'name unknown'}. CAN BOOK BY TEXT: ${canBook ? 'YES (card saved)' : 'NO (no card saved yet)'}.

SERVICES. Each stylist has their own time. Use the service_variation_id that belongs to the chosen stylist:
${menu}

STEPS
1. Find out the service, the stylist (or "anyone") and the day.
2. Use check_availability for that whole day (00:00 to 00:00 next day; at least 24 hours; start from now if the day already started). For "anyone", check each stylist.
3. Offer up to 3 real times. Never make up a time.
4. ${canBook
    ? 'When they pick one, repeat it ("Confirm Fri Nov 20, 2:30 PM with Maria, Long Haircut?") and wait for YES. Then call book_appointment with the exact values from check_availability. If it fails, check again and offer new times.'
    : 'Do NOT book by text. Tell them the time is open and send this link to book it and save a card (it holds the spot, no charge now): ' + s.bookingLink}
5. Never ask for card numbers. If someone sends one, tell them to delete it and use the booking link.

To cancel or change: use list_my_bookings, confirm which one, then cancel_booking. If it is less than ${s.lateCancelHours} hours away, mention the policy first.
POLICY: ${s.policyText}

If you can't help, they're upset, or they ask for a person: say a team member will text them soon and end with [HANDOFF].`;
return [{ json: { prompt, canBook, customerId: info.customerId, message: s.message } }];""")
P = "$('Prepare the AI').first().json"
wf.add("AI Assistant", "@n8n/n8n-nodes-langchain.agent", 1.7, [1760, 0], {
    "promptType": "define", "text": f"={{{{ {P}.message }}}}",
    "options": {"systemMessage": f"={{{{ {P}.prompt }}}}", "maxIterations": 12}}, onError="continueRegularOutput")
wf.add("Claude", "@n8n/n8n-nodes-langchain.lmChatAnthropic", 1.3, [1640, 260], {
    "model": {"__rl": True, "mode": "id", "value": "claude-haiku-5-5"}, "options": {"temperature": 0.3}},
    credentials={"anthropicApi": {"id": "REPLACE_ANTHROPIC_CRED", "name": "Anthropic"}})
wf.add("Memory", "@n8n/n8n-nodes-langchain.memoryBufferWindow", 1.3, [1780, 260], {
    "sessionIdType": "customKey", "sessionKey": f"={{{{ {CFG2}.contactId }}}}", "contextWindowLength": 20})
sq("check_availability", [1920, 260], "POST", "'/v2/bookings/availability/search'",
   "{ query: { filter: { location_id: " + CFG2 + ".locationId,"
   " start_at_range: { start_at: $fromAI('range_start', 'Start of the search window, ISO 8601 with offset', 'string'),"
   " end_at: $fromAI('range_end', 'End of the window, ISO 8601 with offset, at least 24 hours after the start', 'string') },"
   " segment_filters: [{ service_variation_id: $fromAI('service_variation_id', 'service_variation_id for the chosen stylist', 'string'),"
   " team_member_id_filter: { any: [ $fromAI('team_member_id', 'team_member_id of the stylist', 'string') ] } }] } } }",
   tool="Find open times in Square for ONE stylist and ONE service.")
sq("book_appointment", [2060, 260], "POST",
   f"({P}.canBook ? '/v2/bookings' : '/v2/BLOCKED-send-the-booking-link-instead')",
   "{ idempotency_key: " + P + ".customerId + '-' + $fromAI('booking_key', 'Copy the exact start_at again (prevents double booking)', 'string'),"
   " booking: { location_id: " + CFG2 + ".locationId, customer_id: " + P + ".customerId,"
   " start_at: $fromAI('start_at', 'Exact start_at from check_availability', 'string'), customer_note: 'Booked by text',"
   " appointment_segments: [{ team_member_id: $fromAI('team_member_id', 'team_member_id from check_availability', 'string'),"
   " service_variation_id: $fromAI('service_variation_id', 'service_variation_id from check_availability', 'string'),"
   " service_variation_version: $fromAI('service_variation_version', 'service_variation_version from check_availability', 'number') }] } }",
   tool="Book the appointment in Square. Only after a clear YES, and only when CAN BOOK BY TEXT is YES.")
sq("list_my_bookings", [2200, 260], "GET", "'/v2/bookings'",
   query=[("customer_id", f"={{{{ {P}.customerId || 'none' }}}}"), ("location_id", f"={{{{ {CFG2}.locationId }}}}"),
          ("start_at_min", "={{ new Date().toISOString() }}"), ("limit", "20")],
   tool="List this client's upcoming bookings (id, version, start time, stylist).")
sq("cancel_booking", [2340, 260], "POST",
   "'/v2/bookings/' + $fromAI('booking_id', 'id from list_my_bookings', 'string') + '/cancel'",
   "{ booking_version: $fromAI('booking_version', 'version from list_my_bookings', 'number') }",
   tool="Cancel one booking after the client confirmed which one.")
code(wf, "Tidy the Reply", [2100, 0], r"""const out = String($json.output || '').trim();
const handoff = out.includes('[HANDOFF]') || !out;
const reply = out.replace(/\[HANDOFF\]/g, '').trim() || 'Sorry, something went wrong. A team member will text you shortly.';
return [{ json: { reply, handoff } }];""")
ghl(wf, "Reply in GoHighLevel", [2320, -80], "POST", "'/conversations/messages'",
    f"{{ type: 'SMS', contactId: {CFG2}.contactId, message: $json.reply }}", version="2021-04-15")
if_node(wf, "Needs a Person?", [2320, 100], "={{ $json.handoff }}", "boolean", "true")
ghl(wf, "Tag: needs-human", [2540, 100], "POST", f"'/contacts/' + {CFG2}.contactId + '/tags'", "{ tags: ['needs-human'] }")
for a, b in [("Text from GoHighLevel", "Settings"), ("Settings", "Is There a Message?"),
             ("Find Client in Square", "Client Info"), ("Client Info", "Known Client?"),
             ("Check Saved Card", "Prepare the AI"), ("Prepare the AI", "AI Assistant"),
             ("AI Assistant", "Tidy the Reply"), ("Tidy the Reply", "Reply in GoHighLevel"), ("Tidy the Reply", "Needs a Person?")]:
    wf.link(a, b)
wf.link("Is There a Message?", "Find Client in Square", 0)
wf.link("Known Client?", "Check Saved Card", 0)
wf.link("Known Client?", "Prepare the AI", 1)
wf.link("Needs a Person?", "Tag: needs-human", 0)
wf.link("Claude", "AI Assistant", kind="ai_languageModel")
wf.link("Memory", "AI Assistant", kind="ai_memory")
for t in ["check_availability", "book_appointment", "list_my_bookings", "cancel_booking"]:
    wf.link(t, "AI Assistant", kind="ai_tool")
wf.save("salon-A-ai-text-assistant.json")

# =====================================================================
# B. SQUARE -> GOHIGHLEVEL
# =====================================================================
wf = WF("Salon B - Square to GoHighLevel")
wf.note("## B. Square to GoHighLevel\n\n**In simple words:** keeps GoHighLevel up to date with the Square calendar.\n\n- **When a booking changes** (Square tells us right away): adds **sq-booked**, **sq-cancelled**, **sq-late-cancel** or **sq-no-show**.\n- **Every hour:** adds **sq-remind-48h**, **sq-remind-2h** or **sq-completed** at the right time.\n\nIt also fills in the appointment time, stylist and service on the contact. GoHighLevel workflows send the texts.",
        [-60, -440], w=660, h=340, color=4)
webhook(wf, "Square Booking Changed", [0, 0], "POST", "square-events", respond="onReceived", options={"rawBody": True})
wf.add("Every Hour", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 260], {"rule": {"interval": [{"field": "hours", "hoursInterval": 1}]}})
code(wf, "Settings", [220, 120], SETTINGS +
     "return [{ json: { ...SETTINGS, request: $input.first().json }, binary: $input.first().binary }];")
if_node(wf, "From Square or the Clock?", [440, 120], "={{ !!($json.request && $json.request.headers) }}", "boolean", "true")
code(wf, "Check It's From Square", [660, 0], r"""const s = $('Settings').first().json;
const crypto = require('crypto');
let raw;
try { raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8'); }
catch (e) { raw = JSON.stringify(s.request.body); }
const got = String((s.request.headers || {})['x-square-hmacsha256-signature'] || '');
const want = crypto.createHmac('sha256', s.squareWebhookSignatureKey).update(s.squareWebhookUrl + raw).digest('base64');
if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
  throw new Error('This did not come from Square (or the signature key / URL in Settings is wrong).');
}
const event = JSON.parse(raw);
const b = event && event.data && event.data.object && event.data.object.booking;
if (!b || !b.customer_id) return [];
let tag = null;
if (event.type === 'booking.created') tag = 'sq-booked';
else if (b.status === 'NO_SHOW') tag = 'sq-no-show';
else if (b.status === 'CANCELLED_BY_CUSTOMER') {
  const hoursBefore = (new Date(b.start_at) - new Date(b.updated_at || event.created_at)) / 3600e3;
  tag = hoursBefore < s.lateCancelHours ? 'sq-late-cancel' : 'sq-cancelled';
}
return tag ? [{ json: { tag, booking: b } }] : [];""")
sq("Get Today's Bookings", [660, 260], "GET", "'/v2/bookings'",
   query=[("location_id", f"={{{{ {CFG2}.locationId }}}}"),
          ("start_at_min", "={{ new Date(Date.now() - 4 * 3600e3).toISOString() }}"),
          ("start_at_max", "={{ new Date(Date.now() + 50 * 3600e3).toISOString() }}"), ("limit", "100")])
code(wf, "Who Needs a Reminder?", [880, 260], r"""// Runs every hour; each window is 1 hour wide, so each client gets each reminder once.
const H = 3600e3, now = Date.now(), out = [];
for (const b of $input.first().json.bookings || []) {
  if (b.status !== 'ACCEPTED' || !b.customer_id) continue;
  const diff = new Date(b.start_at).getTime() - now;
  let tag = null;
  if (diff >= 48 * H && diff < 49 * H) tag = 'sq-remind-48h';
  else if (diff >= 2 * H && diff < 3 * H) tag = 'sq-remind-2h';
  else if (diff <= -2 * H && diff > -3 * H) tag = 'sq-completed';
  if (tag) out.push({ json: { tag, booking: b } });
}
return out;""")
sq("Get Client from Square", [1100, 120], "GET", "'/v2/customers/' + $json.booking.customer_id")
wf.nodes[-1]["onError"] = "continueRegularOutput"
code(wf, "Contact Details", [1320, 120], r"""const s = $('Settings').first().json;
const ev = $('Merge').item.json;
const b = ev.booking, c = $json.customer || {};
const seg = (b.appointment_segments || [])[0] || {};
const stylist = (s.stylists.find((x) => x.team_member_id === seg.team_member_id) || {}).name || '';
let service = '';
for (const sv of s.services) for (const o of sv.options) if (o.service_variation_id === seg.service_variation_id) service = sv.name;
const when = new Date(b.start_at).toLocaleString('en-US', { timeZone: s.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fields = { appt_time: when, appt_stylist: stylist, appt_service: service };
if (ev.tag === 'sq-booked') fields.booked_via = b.source === 'API' ? 'text' : 'square';
return { json: { phone: c.phone_number || '', firstName: c.given_name || '', lastName: c.family_name || '', tag: ev.tag, fields } };""", per_item=True)
wf.add("Merge", "n8n-nodes-base.noOp", 1, [880, 120], {})
if_node(wf, "Has a Phone?", [1540, 120], "={{ $json.phone }}", "string", "notEmpty")
ghl(wf, "Update Contact in GoHighLevel", [1760, 120], "POST", "'/contacts/upsert'",
    "{ locationId: " + CFG2 + ".ghlLocationId, phone: $json.phone, firstName: $json.firstName || undefined,"
    " lastName: $json.lastName || undefined,"
    " customFields: Object.entries($json.fields).map(([key, field_value]) => ({ key, field_value })) }")
ghl(wf, "Add the Tag", [1980, 120], "POST", "'/contacts/' + $json.contact.id + '/tags'",
    "{ tags: [ $('Contact Details').item.json.tag ] }")
for a, b in [("Square Booking Changed", "Settings"), ("Every Hour", "Settings"), ("Settings", "From Square or the Clock?"),
             ("Check It's From Square", "Merge"), ("Get Today's Bookings", "Who Needs a Reminder?"),
             ("Who Needs a Reminder?", "Merge"), ("Merge", "Get Client from Square"),
             ("Get Client from Square", "Contact Details"), ("Contact Details", "Has a Phone?"),
             ("Update Contact in GoHighLevel", "Add the Tag")]:
    wf.link(a, b)
wf.link("From Square or the Clock?", "Check It's From Square", 0)
wf.link("From Square or the Clock?", "Get Today's Bookings", 1)
wf.link("Has a Phone?", "Update Contact in GoHighLevel", 0)
wf.save("salon-B-square-to-gohighlevel.json")
print("ok")
