# Vercel Deployment (Frontend)

## 1) Project Import
- Import this GitHub repository in Vercel.
- Set **Root Directory** to `frontend`.
- Framework should be detected as **Next.js**.

## 2) Environment Variables
Required (explicit):
- Add one of these in frontend service/project environment variables:
  - `BACKEND_API_URL=https://your-backend.example.com`
  - `RAILWAY_BACKEND_URL=https://your-backend.example.com`
- Optional: `NEXT_PUBLIC_API_URL` with the same value.

Critical placement:
- Set this variable on the frontend service itself.
- Setting it only on backend service does not make frontend `/api/*` proxy work.

Important:
- `/api/*` is now handled by a runtime Next route proxy, not rewrites.
- If backend URL is missing or points to frontend host, proxy returns a clear JSON error instead of opaque 502 failures.

## 3) Build Settings
Defaults are fine once root directory is `frontend`:
- Install Command: `npm install`
- Build Command: `npm run build`
- Output: Next.js default

## 4) Verify After Deploy
- Open your Vercel frontend URL.
- Check API proxy route:
  - `https://<frontend-domain>/api/health`
- It should return backend health JSON via route proxy.

## Notes
- The runtime proxy resolves backend URL in this order:
  1. `BACKEND_API_URL`
  2. `RAILWAY_BACKEND_URL`
  3. `NEXT_PUBLIC_API_URL`
