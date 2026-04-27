# Easy Uploader

A self-hosted file and photo sharing app for Unraid. Create password-protected share links — guests visit the URL, enter the password, and upload files directly to your server.

## Features

- Password-protected share links with custom URL slugs
- Optional expiry dates per share
- Guests see their own upload history via a 10-day persistent cookie
- Required name and optional comment on every upload
- Admin panel — manage shares, browse all files with thumbnails, delete files
- Drag-and-drop upload page, mobile friendly
- Single Docker container, two mapped volumes

## Quick Start

```yaml
services:
  easy-uploader:
    image: devlindelfuego/easy-uploader:latest
    ports:
      - "3000:3000"
    volumes:
      - /mnt/user/appdata/easy-uploader/data:/app/data
      - /mnt/user/Photos/uploads:/app/uploads
    environment:
      - ADMIN_USERNAME=admin
      - ADMIN_PASSWORD=your-strong-password
      - SESSION_SECRET=your-long-random-secret
      - MAX_FILE_SIZE_MB=500
      - NODE_ENV=production
      - COOKIE_SECURE=false
      - TRUST_PROXY=false
      - PUID=99
      - PGID=100
    restart: unless-stopped
```

Visit `http://[server-ip]:3000/admin` after starting.

## Unraid

**Community Applications** — search for Easy Uploader and install.

**Manual template** — go to Docker → Add Container and paste:

```
https://raw.githubusercontent.com/DevlinDelFuego/Easy-Uploader/main/easy-uploader.xml
```

### Volume layout

Each share gets its own subfolder under the uploads path:

```
/mnt/user/Photos/uploads/
├── mothersday/
└── fathersday/
```

Map the uploads root to wherever you want files on your array.

## Reverse Proxy

Run Easy Uploader behind Nginx Proxy Manager or SWAG for HTTPS. Set `COOKIE_SECURE=true` and `TRUST_PROXY=true` when behind a reverse proxy so session cookies are marked secure and client IPs are forwarded correctly.

## Environment Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `ADMIN_USERNAME` | `admin` | No | Admin panel username |
| `ADMIN_PASSWORD` | — | **Yes** | Admin panel password |
| `SESSION_SECRET` | — | **Yes** | Long random string for signing cookies — generate at [generate-secret.vercel.app](https://generate-secret.vercel.app/64) |
| `PORT` | `3000` | No | Port the app listens on |
| `MAX_FILE_SIZE_MB` | `500` | No | Max upload size per file in MB |
| `NODE_ENV` | `production` | No | Node.js environment — keep as `production` |
| `COOKIE_SECURE` | `false` | No | Set to `true` only when accessing over HTTPS via a reverse proxy |
| `TRUST_PROXY` | `false` | No | Set to `true` only when running behind a reverse proxy (Nginx Proxy Manager, SWAG, etc.) |
| `PUID` | `99` | No | UID the process runs as (99 = nobody on Unraid) |
| `PGID` | `100` | No | GID the process runs as (100 = users on Unraid) |

## Building from Source

```bash
git clone https://github.com/DevlinDelFuego/Easy-Uploader.git
cd Easy-Uploader
npm install
cp .env.example .env
npm run dev
```
