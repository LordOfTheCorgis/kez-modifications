# Deploying to nginx

Everything lives under `/home/kezmodifications`:

```
/home/kezmodifications/
├── app/        # this repository (git clone)
├── dist/       # built frontend (copied from app/dist after npm run build)
├── data/       # products.json, reviews.json, settings.json (created automatically)
├── uploads/    # product images uploaded from the admin panel
└── .env        # ADMIN_PASSWORD=your-strong-password
```

## 1. First-time setup

```bash
sudo useradd -r -m -d /home/kezmodifications kez
sudo -u kez git clone <repo-url> /home/kezmodifications/app
cd /home/kezmodifications/app
npm install
npm run build
cp -r dist /home/kezmodifications/dist
echo "ADMIN_PASSWORD=change-me" | sudo -u kez tee /home/kezmodifications/.env
sudo chmod 600 /home/kezmodifications/.env
```

## 2. systemd unit — `/etc/systemd/system/kez-api.service`

```ini
[Unit]
Description=Kez Modifications API
After=network.target

[Service]
User=kez
WorkingDirectory=/home/kezmodifications/app
ExecStart=/usr/bin/node server/server.js
Environment=KEZ_ROOT=/home/kezmodifications
Environment=PORT=3001
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kez-api
```

## 3. nginx server block

```nginx
server {
    listen 80;
    server_name kezmodifications.com www.kezmodifications.com;

    root /home/kezmodifications/dist;
    index index.html;

    # API (login, products, reviews, settings, upload)
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 20m;
    }

    # Product pages get OG meta tags injected by the API server
    # so Discord/Twitter embeds show the right image and title.
    location /product/ {
        proxy_pass http://127.0.0.1:3001;
    }

    # Uploaded images served straight from disk
    location /uploads/ {
        alias /home/kezmodifications/uploads/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback
    location / {
        try_files $uri /index.html;
    }
}
```

Then `sudo nginx -t && sudo systemctl reload nginx`, and put TLS in front with
`sudo certbot --nginx -d kezmodifications.com -d www.kezmodifications.com`.

## 4. Updating the site

```bash
cd /home/kezmodifications/app
git pull
npm run build
rm -rf /home/kezmodifications/dist && cp -r dist /home/kezmodifications/dist
```

Products, reviews, settings, and uploads are untouched by updates — they live
outside the app directory. Back up `/home/kezmodifications/data` and
`/home/kezmodifications/uploads` (a nightly `tar` or rsync is plenty).

## Local development

```bash
npm run server   # API on :3001, data in ./local-data (gitignored)
npm run dev      # Vite on :5173, proxies /api and /uploads to :3001
```

`ADMIN_PASSWORD` for local dev comes from the repo's `.env` file.
