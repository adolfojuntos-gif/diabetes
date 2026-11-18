# Run n8n on your own server (cheapest)

About **$5–12 a month** for unlimited executions, versus about $24+ a month for n8n Cloud Starter (2,500 executions).

## What you need
- **A server:** Hetzner Cloud CX22 (about €4–5 a month) or a DigitalOcean 2 GB Droplet (about $12 a month), running **Ubuntu 24.04**.
- **A domain**, about $12 a year, for example from Namecheap or Cloudflare. You'll use a subdomain such as `n8n.yourdomain.com`.

## Step 1: Create the server
1. Create the server with **Ubuntu 24.04** and copy its **IP address**.
2. In your domain's DNS settings, add an **A record**: name `n8n`, value = the server's IP.
3. Turn on the provider's **automatic backups** (about $1–2 a month).

## Step 2: Install Docker
Connect to the server. On Windows, open PowerShell and run `ssh root@YOUR_SERVER_IP`. Then run each line:
```bash
curl -fsSL https://get.docker.com | sh
```
```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## Step 3: Start n8n
```bash
mkdir -p ~/n8n && cd ~/n8n
```
Copy `docker-compose.yml`, `Caddyfile` and `.env.example` from this folder into `~/n8n`. Then:
```bash
cp .env.example .env
```
```bash
openssl rand -hex 32
```
Open `.env` with `nano .env`:
- Set `N8N_DOMAIN` to your address.
- Paste the random value from the previous step after `N8N_ENCRYPTION_KEY=`.
- Save with **Ctrl+O**, press Enter, and exit with **Ctrl+X**.

```bash
docker compose up -d
```
After about a minute, open `https://n8n.yourdomain.com` and create your owner account.

## Step 4: Free license key (optional extras)
In n8n, go to **Settings → Usage and plan → Unlock selected paid features for free**, enter your email, and paste the key you receive.

## Step 5: Move the salon workflows
1. **Import** `salon-A-ai-text-assistant-telnyx.json` and `salon-B-square-texts-telnyx.json`.
2. **Recreate the credentials**, since credentials don't transfer between n8n instances:
   - Square (Header Auth)
   - Telnyx (Header Auth)
   - Anthropic
3. In **Settings** in both workflows, set `squareWebhookUrl` to `https://n8n.yourdomain.com/webhook/square-events`.
4. Update the webhooks outside n8n:
   - **Square Developer → Webhooks:** `https://n8n.yourdomain.com/webhook/square-events`
   - **Telnyx Messaging Profile:** `https://n8n.yourdomain.com/webhook/telnyx-sms`
5. Test, then **Publish** both workflows.

Self-hosted n8n has no execution limit, so the hourly check can run all 24 hours if you like.

## Monthly upkeep (about 15 minutes)
Update n8n:
```bash
cd ~/n8n && docker compose pull && docker compose up -d
```
Check that it's running:
```bash
docker compose ps
```

## Good to know
- **Keep `.env` safe.** If you lose `N8N_ENCRYPTION_KEY`, saved credentials can't be read after a restore.
- **Licensing:** self-hosted n8n uses the **Sustainable Use License**. Running automations for your clients' businesses is generally fine. Reselling n8n itself, or giving clients access to your n8n editor, is not. Read the license FAQ on n8n.io.
- **Several salons on one server:** import each salon's 2 workflows with their own **Settings** and different webhook paths, for example `telnyx-sms-salon2`.
