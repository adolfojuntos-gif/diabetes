"""Telnyx edition: n8n + Square + Telnyx SMS. No GoHighLevel. 2 workflows."""
import json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_OUT = sys.argv[1]
os.makedirs(REAL_OUT, exist_ok=True)
src = open(os.path.join(HERE, "gen.py")).read()
head = src.split("# =====================================================================\n# 1. AI TEXT")[0]
sys.argv = [sys.argv[0], tempfile.mkdtemp()]
exec(head)
OUT = REAL_OUT
S = "$('Settings').first().json"

TELNYX_CRED = {"httpHeaderAuth": {"id": "REPLACE_TELNYX_CRED", "name": "Telnyx API (Bearer token)"}}


def text(wf, name, pos, to_expr, text_expr):
    """Send an SMS through Telnyx."""
    return wf.add(name, "n8n-nodes-base.httpRequest", 4.2, pos, {
        "method": "POST", "url": "https://api.telnyx.com/v2/messages",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ from: " + S + ".salonPhone, to: " + to_expr + ", text: " + text_expr + " }) }}",
        "options": {}}, credentials=TELNYX_CRED, onError="continueRegularOutput")


def sq(wf, name, pos, method, path, body=None, query=None, tool=None, on_error=None):
    square(wf, name, pos, method, path, body, query, tool, on_error)
    node = wf.nodes[-1]
    node["parameters"] = json.loads(json.dumps(node["parameters"]).replace("$('Config')", "$('Settings')"))
    return name


SETTINGS = r"""// ================= YOUR SALON SETTINGS =================
// Fill this in once, then copy the SAME settings into the other workflow.
const SETTINGS = {
  salonName: 'Your Salon Name',
  timezone: 'America/Chicago',
  salonPhone: '+19565550100',        // your Telnyx number (texts come from here)
  managerPhone: '+19565550101',      // gets no-show / late-cancel / "needs a person" texts
  bookingLink: 'https://book.squareup.com/appointments/YOUR-LINK',  // Square online booking page
  reviewLink: 'https://g.page/r/YOUR-GOOGLE-REVIEW-LINK',

  // Square (Sandbox while testing; live = https://connect.squareup.com)
  squareBaseUrl: 'https://connect.squareupsandbox.com',
  squareVersion: '2025-01-23',
  locationId: 'YOUR_SQUARE_LOCATION_ID',
  squareWebhookSignatureKey: 'YOUR_SQUARE_WEBHOOK_SIGNATURE_KEY',
  squareWebhookUrl: 'https://YOUR-N8N-ADDRESS/webhook/square-events',

  // Telnyx: Mission Control > Keys & Credentials > Public Key (optional, but recommended)
  telnyxPublicKey: '',

  lateCancelHours: 24,
  policyText: 'Free to cancel or change up to 24 hours before. Late cancellations and no-shows may be charged a fee to the card saved when booking.',

  // Each stylist has their OWN time for each service.
  // In Square, make one version of the service per speed (same name and price for clients).
  stylists: [
    { name: 'Maria', team_member_id: 'TEAM_MEMBER_ID_MARIA', phone: '+19565550111' },
    { name: 'Ana',   team_member_id: 'TEAM_MEMBER_ID_ANA',   phone: '+19565550112' },
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
wf = WF("Salon A - AI Text Assistant (Telnyx)")
wf.note("## A. AI Text Assistant\n\n**In simple words:** a client texts the salon's Telnyx number. The AI checks the real Square calendar and offers open times.\n\n- **Returning client with a saved card:** the AI books it in Square.\n- **New client:** the AI sends the Square booking link. Square saves their card and shows the policy.\n- **AI gets stuck or client asks for a person:** the manager gets a text, and the AI stays quiet with that client for 12 hours.\n\n**Set up:** fill in **Settings**, pick credentials on the nodes with warnings.",
        [-60, -440], w=660, h=360, color=4)
webhook(wf, "Text Comes In (Telnyx)", [0, 0], "POST", "telnyx-sms", respond="onReceived", options={"rawBody": True})
code(wf, "Settings", [220, 0], SETTINGS + r"""const crypto = require('crypto');
const req = $input.first().json;
const body = req.body || {};

// Optional security check: was this really sent by Telnyx?
if (SETTINGS.telnyxPublicKey) {
  let raw;
  try { raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8'); } catch (e) { raw = JSON.stringify(body); }
  const h = req.headers || {};
  const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(SETTINGS.telnyxPublicKey, 'base64')]), format: 'der', type: 'spki' });
  const ok = crypto.verify(null, Buffer.from(`${h['telnyx-timestamp']}|${raw}`), key, Buffer.from(String(h['telnyx-signature-ed25519'] || ''), 'base64'));
  if (!ok) throw new Error('This did not come from Telnyx (or telnyxPublicKey in Settings is wrong).');
}

const d = body.data || {};
const p = d.payload || {};
const message = String(p.text || '').trim();
const phone = (p.from && p.from.phone_number) || '';
// Only real incoming texts. STOP / HELP / START are handled by Telnyx itself.
const keyword = /^(stop|stopall|unsubscribe|end|quit|help|info|start|unstop)$/i.test(message);
if (d.event_type !== 'message.received' || !message || !phone || keyword) return [];

// Paused because a person is handling this client?
const memory = $getWorkflowStaticData('global');
memory.paused = memory.paused || {};
if (memory.paused[phone] && memory.paused[phone] > Date.now()) return [];

return [{ json: { ...SETTINGS, phone, message } }];""")
sq(wf, "Find Client in Square", [440, 0], "POST", "'/v2/customers/search'",
   "{ limit: 1, query: { filter: { phone_number: { exact: $json.phone } } } }")
code(wf, "Client Info", [660, 0], r"""const c = ($input.first().json.customers || [])[0];
return [{ json: { customerId: c ? c.id : '', known: !!c, name: c ? [c.given_name, c.family_name].filter(Boolean).join(' ') : '' } }];""")
if_node(wf, "Known Client?", [880, 0], "={{ $json.known }}", "boolean", "true")
sq(wf, "Check Saved Card", [1100, -80], "GET", "'/v2/cards'", query=[("customer_id", "={{ $json.customerId }}")])
code(wf, "Prepare the AI", [1320, 0], r"""const s = $('Settings').first().json;
const info = $('Client Info').first().json;
const cards = info.known ? (($input.first().json.cards || []).filter((c) => c.enabled !== false)) : [];
const canBook = info.known && cards.length > 0;

const now = new Date();
const nowText = now.toLocaleString('en-US', { timeZone: s.timezone, dateStyle: 'full', timeStyle: 'short' });
const off = (now.toLocaleString('en-US', { timeZone: s.timezone, timeZoneName: 'longOffset' }).match(/GMT([+-]\d{2}:\d{2})/) || [])[1] || '+00:00';
const menu = s.services.map((sv) => `- ${sv.name} (${sv.price}):\n` + sv.options.map((o) =>
  `    ${o.stylist}: ${o.minutes} min -> team_member_id=${o.team_member_id}, service_variation_id=${o.service_variation_id}`).join('\n')).join('\n');

const prompt = `You are the friendly text-message assistant for ${s.salonName}. Reply in 1-3 short sentences, plain text. Reply in the same language the client writes in.

NOW: ${nowText} (${s.timezone}, UTC offset ${off}). Send times to tools as ISO 8601 with this offset, e.g. 2026-11-20T14:00:00${off}.
CLIENT: ${info.name || 'name unknown'}. CAN BOOK BY TEXT: ${canBook ? 'YES (card saved)' : 'NO (no card saved yet)'}.

SERVICES. Each stylist has their own time. Use the service_variation_id that belongs to the chosen stylist:
${menu}

STEPS
1. Find out the service, the stylist (or "anyone") and the day.
2. Use check_availability for that whole day (00:00 to 00:00 next day; at least 24 hours; start from now if the day already started). For "anyone", check each stylist.
3. Offer up to 3 real times. Never make up a time.
4. ${canBook
    ? 'When they pick one, repeat it ("Confirm Fri Nov 20, 2:30 PM with Maria, Long Haircut?") and wait for a clear yes. Then call book_appointment with the exact values from check_availability. If it fails, check again and offer new times.'
    : 'Do NOT book by text. Tell them the time is open and send this link to book it and save a card (it holds the spot, no charge now): ' + s.bookingLink}
5. Never ask for card numbers. If someone sends one, tell them to delete it and use the booking link.

To cancel or change: use list_my_bookings, confirm which one, then cancel_booking. If it is less than ${s.lateCancelHours} hours away, mention the policy first.
POLICY: ${s.policyText}

If you can't help, they're upset, or they ask for a person: say a team member will text them soon and end with [HANDOFF].`;
return [{ json: { prompt, canBook, customerId: info.customerId, message: s.message } }];""")
P = "$('Prepare the AI').first().json"
wf.add("AI Assistant", "@n8n/n8n-nodes-langchain.agent", 1.7, [1540, 0], {
    "promptType": "define", "text": f"={{{{ {P}.message }}}}",
    "options": {"systemMessage": f"={{{{ {P}.prompt }}}}", "maxIterations": 12}}, onError="continueRegularOutput")
wf.add("Claude", "@n8n/n8n-nodes-langchain.lmChatAnthropic", 1.3, [1420, 260], {
    "model": {"__rl": True, "mode": "id", "value": "claude-haiku-5-5"}, "options": {"temperature": 0.3}},
    credentials={"anthropicApi": {"id": "REPLACE_ANTHROPIC_CRED", "name": "Anthropic"}})
wf.add("Memory", "@n8n/n8n-nodes-langchain.memoryBufferWindow", 1.3, [1560, 260], {
    "sessionIdType": "customKey", "sessionKey": f"={{{{ {S}.phone }}}}", "contextWindowLength": 20})
sq(wf, "check_availability", [1700, 260], "POST", "'/v2/bookings/availability/search'",
   "{ query: { filter: { location_id: " + S + ".locationId,"
   " start_at_range: { start_at: $fromAI('range_start', 'Start of the search window, ISO 8601 with offset', 'string'),"
   " end_at: $fromAI('range_end', 'End of the window, ISO 8601 with offset, at least 24 hours after the start', 'string') },"
   " segment_filters: [{ service_variation_id: $fromAI('service_variation_id', 'service_variation_id for the chosen stylist', 'string'),"
   " team_member_id_filter: { any: [ $fromAI('team_member_id', 'team_member_id of the stylist', 'string') ] } }] } } }",
   tool="Find open times in Square for ONE stylist and ONE service.")
sq(wf, "book_appointment", [1840, 260], "POST",
   f"({P}.canBook ? '/v2/bookings' : '/v2/BLOCKED-send-the-booking-link-instead')",
   "{ idempotency_key: " + P + ".customerId + '-' + $fromAI('booking_key', 'Copy the exact start_at again (prevents double booking)', 'string'),"
   " booking: { location_id: " + S + ".locationId, customer_id: " + P + ".customerId,"
   " start_at: $fromAI('start_at', 'Exact start_at from check_availability', 'string'), customer_note: 'Booked by text',"
   " appointment_segments: [{ team_member_id: $fromAI('team_member_id', 'team_member_id from check_availability', 'string'),"
   " service_variation_id: $fromAI('service_variation_id', 'service_variation_id from check_availability', 'string'),"
   " service_variation_version: $fromAI('service_variation_version', 'service_variation_version from check_availability', 'number') }] } }",
   tool="Book the appointment in Square. Only after a clear yes, and only when CAN BOOK BY TEXT is YES.")
sq(wf, "list_my_bookings", [1980, 260], "GET", "'/v2/bookings'",
   query=[("customer_id", f"={{{{ {P}.customerId || 'none' }}}}"), ("location_id", f"={{{{ {S}.locationId }}}}"),
          ("start_at_min", "={{ new Date().toISOString() }}"), ("limit", "20")],
   tool="List this client's upcoming bookings (id, version, start time, stylist).")
sq(wf, "cancel_booking", [2120, 260], "POST",
   "'/v2/bookings/' + $fromAI('booking_id', 'id from list_my_bookings', 'string') + '/cancel'",
   "{ booking_version: $fromAI('booking_version', 'version from list_my_bookings', 'number') }",
   tool="Cancel one booking after the client confirmed which one.")
code(wf, "Tidy the Reply", [1880, 0], r"""const s = $('Settings').first().json;
const out = String($json.output || '').trim();
const handoff = out.includes('[HANDOFF]') || !out;
const reply = out.replace(/\[HANDOFF\]/g, '').trim() || 'Sorry, something went wrong. A team member will text you shortly.';
if (handoff) {
  // Let a person take over: the AI stays quiet with this client for 12 hours
  const memory = $getWorkflowStaticData('global');
  memory.paused = memory.paused || {};
  memory.paused[s.phone] = Date.now() + 12 * 3600e3;
}
return [{ json: { reply, handoff } }];""")
text(wf, "Text the Client", [2100, -80], f"{S}.phone", "$json.reply")
if_node(wf, "Needs a Person?", [2100, 100], "={{ $('Tidy the Reply').first().json.handoff }}", "boolean", "true")
text(wf, "Text the Manager", [2320, 100], f"{S}.managerPhone",
     f"'Client ' + {S}.phone + ' needs a person. Their last message: \"' + {S}.message + '\". The AI will stay quiet with them for 12 hours.'")
for a, b in [("Text Comes In (Telnyx)", "Settings"), ("Settings", "Find Client in Square"),
             ("Find Client in Square", "Client Info"), ("Client Info", "Known Client?"),
             ("Check Saved Card", "Prepare the AI"), ("Prepare the AI", "AI Assistant"),
             ("AI Assistant", "Tidy the Reply"), ("Tidy the Reply", "Text the Client"), ("Tidy the Reply", "Needs a Person?")]:
    wf.link(a, b)
wf.link("Known Client?", "Check Saved Card", 0)
wf.link("Known Client?", "Prepare the AI", 1)
wf.link("Needs a Person?", "Text the Manager", 0)
wf.link("Claude", "AI Assistant", kind="ai_languageModel")
wf.link("Memory", "AI Assistant", kind="ai_memory")
for t in ["check_availability", "book_appointment", "list_my_bookings", "cancel_booking"]:
    wf.link(t, "AI Assistant", kind="ai_tool")
wf.save("salon-A-ai-text-assistant-telnyx.json")

# =====================================================================
# B. SQUARE -> TEXTS
# =====================================================================
wf = WF("Salon B - Square Texts and Reminders (Telnyx)")
wf.note("## B. Square Texts and Reminders\n\n**In simple words:** watches the Square calendar and sends the right text.\n\n**When a booking changes** (Square tells us right away):\n- New booking: confirmation to the client (if they booked online) + heads-up to the stylist\n- Cancelled in time: tells the stylist the time is open\n- Late cancel or no-show: tells the manager, who can charge the fee in the Square app\n\n**Every hour:** reminder 2 days before, reminder 2 hours before, thank-you + review link after the visit.\n\n**Turn off Square's own text reminders** so clients don't get two.",
        [-60, -480], w=660, h=400, color=4)
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
let kind = null;
if (event.type === 'booking.created') kind = 'booked';
else if (b.status === 'NO_SHOW') kind = 'no_show';
else if (b.status === 'CANCELLED_BY_CUSTOMER') {
  const hoursBefore = (new Date(b.start_at) - new Date(b.updated_at || event.created_at)) / 3600e3;
  kind = hoursBefore < s.lateCancelHours ? 'late_cancel' : 'cancelled';
}
return kind ? [{ json: { kind, booking: b } }] : [];""")
sq(wf, "Get Upcoming Bookings", [660, 260], "GET", "'/v2/bookings'",
   query=[("location_id", f"={{{{ {S}.locationId }}}}"),
          ("start_at_min", "={{ new Date(Date.now() - 4 * 3600e3).toISOString() }}"),
          ("start_at_max", "={{ new Date(Date.now() + 50 * 3600e3).toISOString() }}"), ("limit", "100")])
code(wf, "Who Needs a Reminder?", [880, 260], r"""// Runs every hour; each window is 1 hour wide, so each client gets each reminder once.
const H = 3600e3, now = Date.now(), out = [];
for (const b of $input.first().json.bookings || []) {
  if (b.status !== 'ACCEPTED' || !b.customer_id) continue;
  const diff = new Date(b.start_at).getTime() - now;
  let kind = null;
  if (diff >= 48 * H && diff < 49 * H) kind = 'remind_2_days';
  else if (diff >= 2 * H && diff < 3 * H) kind = 'remind_2_hours';
  else if (diff <= -2 * H && diff > -3 * H) kind = 'thank_you';
  if (kind) out.push({ json: { kind, booking: b } });
}
return out;""")
wf.add("Together", "n8n-nodes-base.noOp", 1, [1100, 120], {})
sq(wf, "Get Client from Square", [1320, 120], "GET", "'/v2/customers/' + $json.booking.customer_id", on_error="continueRegularOutput")
code(wf, "Write the Texts", [1540, 120], r"""const s = $('Settings').first().json;
const events = $('Together').all();
const out = [];
$input.all().forEach((item, i) => {
  const ev = events[i].json, b = ev.booking, c = item.json.customer || {};
  const seg = (b.appointment_segments || [])[0] || {};
  const st = s.stylists.find((x) => x.team_member_id === seg.team_member_id) || {};
  let service = 'your appointment';
  for (const sv of s.services) for (const o of sv.options) if (o.service_variation_id === seg.service_variation_id) service = sv.name;
  const fmt = (d, o) => new Date(d).toLocaleString('en-US', { timeZone: s.timezone, ...o });
  const when = fmt(b.start_at, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const time = fmt(b.start_at, { hour: 'numeric', minute: '2-digit' });
  const freeUntil = fmt(new Date(b.start_at).getTime() - s.lateCancelHours * 3600e3, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const first = c.given_name || 'there';
  const name = [c.given_name, c.family_name].filter(Boolean).join(' ') || 'A client';
  const client = c.phone_number || '';
  const withWho = st.name ? ` with ${st.name}` : '';
  const add = (to, text) => { if (to) out.push({ json: { to, text } }); };

  if (ev.kind === 'booked') {
    if (b.source !== 'API') add(client, `Hi ${first}! You're booked at ${s.salonName}: ${service}${withWho}, ${when}. Free to change until ${freeUntil}. Reply here if you need anything.`);
    add(st.phone, `New booking: ${name}, ${service}, ${when}.`);
  } else if (ev.kind === 'cancelled') {
    add(st.phone, `Cancelled: ${name}, ${when}. That time is open again.`);
  } else if (ev.kind === 'late_cancel' || ev.kind === 'no_show') {
    const label = ev.kind === 'no_show' ? 'NO-SHOW' : 'LATE CANCEL';
    add(s.managerPhone, `${label}: ${name} (${client || 'no phone'}), ${service}${withWho}, ${when}. To charge the fee, open the appointment in the Square app.`);
    if (ev.kind === 'late_cancel') add(st.phone, `Late cancel: ${name}, ${when}. That time is open again.`);
  } else if (ev.kind === 'remind_2_days') {
    add(client, `Hi ${first}! See you ${when} at ${s.salonName}${withWho}. Need to change it? Reply here. Changes are free until ${freeUntil}.`);
  } else if (ev.kind === 'remind_2_hours') {
    add(client, `Hi ${first}, see you soon! Your appointment at ${s.salonName} is today at ${time}.`);
  } else if (ev.kind === 'thank_you') {
    add(client, `Thanks for coming in, ${first}! If you loved your hair, a quick review means a lot: ${s.reviewLink}`);
  }
});
return out;""")
text(wf, "Send Text", [1760, 120], "$json.to", "$json.text")
for a, b in [("Square Booking Changed", "Settings"), ("Every Hour", "Settings"), ("Settings", "From Square or the Clock?"),
             ("Check It's From Square", "Together"), ("Get Upcoming Bookings", "Who Needs a Reminder?"),
             ("Who Needs a Reminder?", "Together"), ("Together", "Get Client from Square"),
             ("Get Client from Square", "Write the Texts"), ("Write the Texts", "Send Text")]:
    wf.link(a, b)
wf.link("From Square or the Clock?", "Check It's From Square", 0)
wf.link("From Square or the Clock?", "Get Upcoming Bookings", 1)
wf.save("salon-B-square-texts-telnyx.json")
print("ok")
