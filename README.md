# Vybridge Draft Site

This project is a static draft website built with plain HTML, CSS, and JavaScript.

## Language Rule

- Keep all public-facing content in **English** by default.

## Pages

- `index.html` — main landing page
- `register/` — sign up
- `login/` — log in

## Local development

Run the Node.js server:

```bash
npm start
```

Then open:

- `http://localhost:3000/`
- `http://localhost:3000/register`
- `http://localhost:3000/login`

## Deploy to Railway

This project runs as a Node.js web service with a `Dockerfile`.

### 1. Push to GitHub

Ensure the latest code is on the `main` branch of your repository.

### 2. Create a Railway project

1. Open [railway.com](https://railway.com) and sign in.
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select the `vybridge` repository and branch `main`.

### 3. Railway settings

Railway detects the `Dockerfile` automatically. No custom build command is required.

| Setting | Value |
|---------|-------|
| **Builder** | Dockerfile |
| **Start command** | *(from Dockerfile `CMD`)* |
| **Healthcheck** | optional: `/health` |

### 4. Environment variables

In Railway → **Variables**, add if needed:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | set by Railway automatically |

Do not commit secrets to Git. Use Railway Variables or a local `.env` file (see `.env.example`).

### 5. Deploy

Railway deploys automatically on every push to `main`.  
After deploy, open the generated `*.up.railway.app` URL.

## Notes

- This is currently a draft. Replace placeholder `#` links with real URLs before production launch.
- Add analytics, legal pages, and form backend integrations before going live.
