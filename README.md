# Boomerang backend (zero dependencies)

## Run on your laptop
    node server.js          # needs Node 18+
    open http://localhost:3000/print   (admin password: boomerang)

## Put it online (free): Render.com
1. Upload this folder to a GitHub repo.
2. Render > New > Web Service > connect repo. Build command: (empty). Start command: `node server.js`.
3. Environment variables: ADMIN_PASS = your own password.
4. Your site: https://YOUR-APP.onrender.com . Open /print, create codes, print the QR stickers.
Note: Render's free disk resets on redeploy. For the real pilot, add a Render Disk and set DATA_DIR to it, or move to Supabase.

## How it works
- /print (admin): makes unique codes BMR-XXXXX, each with its own QR to /s/CODE.
- Scan an unclaimed sticker: owner claims it (item + contact), gets a private key kept in that browser.
- Scan a claimed sticker: finder sends an anonymous message. Contact details are never sent to finders.
- Owner opens the site on the same phone: inbox refreshes every 6 s and shows a browser notification.
- Optional email/WhatsApp/Telegram alert: set NOTIFY_WEBHOOK to a webhook URL (Zapier/Make); it receives {to,item,text}.
