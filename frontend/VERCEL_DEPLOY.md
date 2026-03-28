# Vercel Deployment (Frontend)

## 1) Project Import
- Import this GitHub repository in Vercel.
- Set **Root Directory** to `frontend`.
- Framework should be detected as **Next.js**.

## 2) Environment Variables
Preferred (auto):
- If your Vercel project is connected to Railway integration and receives Railway vars,
  frontend rewrites can auto-detect backend from:
  - `RAILWAY_PUBLIC_DOMAIN`
  - `RAILWAY_STATIC_URL`

Fallback (explicit):
- Add one of these in Vercel Project Settings -> Environment Variables:
  - `BACKEND_API_URL=https://your-backend.example.com`
  - `RAILWAY_BACKEND_URL=https://your-backend.example.com`
- Optional: `NEXT_PUBLIC_API_URL` with same value for direct client calls.

## 3) Build Settings
Defaults are fine once root directory is `frontend`:
- Install Command: `npm install`
- Build Command: `npm run build`
- Output: Next.js default

## 4) Verify After Deploy
- Open your Vercel frontend URL.
- Check API proxy route:
  - `https://<frontend-domain>/api/health`
- It should return backend health JSON via rewrite.

## Notes
- In development, frontend rewrites default to `http://localhost:8000`.
- In production, rewrite base URL resolution order is:
  1. `BACKEND_API_URL`
  2. `NEXT_PUBLIC_API_URL`
  3. `RAILWAY_BACKEND_URL`
  4. `RAILWAY_PUBLIC_DOMAIN`
  5. `RAILWAY_STATIC_URL`
- If no backend URL is available in production, `/api/*` routes are not rewritten.
