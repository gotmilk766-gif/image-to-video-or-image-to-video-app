# image-to-video-app

Upload an image → get a short vertical video back, for TikTok / Reels / Fanvue.

**Fully free to run.** No Firebase, no card required anywhere. Just Vercel
(hosting) + Replicate (the video model), both of which have free tiers that
cover personal use.

- **Frontend + backend:** one Next.js app. The "backend" is a single API
  route (`pages/api/render.js`) that runs on Vercel — no separate server to
  deploy.
- **Model:** [wan-video/wan-2.2-i2v-fast](https://replicate.com/wan-video/wan-2.2-i2v-fast)
  on Replicate — currently the cheapest/fastest widely-used image-to-video
  model.
- **No database, no storage bucket.** The browser sends your image straight
  to the API route as base64; the route calls Replicate and hands back the
  finished video's URL. Nothing is stored anywhere.

## 1. Get a Replicate API token

https://replicate.com/account/api-tokens — sign up, create a token, copy it.

## 2. Run locally (optional, for testing before deploying)

```bash
npm install
cp .env.local.example .env.local
# open .env.local and paste your token after REPLICATE_TOKEN=
npm run dev
```

Open http://localhost:3000.

## 3. Deploy to Vercel

1. Push this repo to GitHub (if you haven't already).
2. On vercel.com, import the repo.
3. In the import screen (or afterward in Project Settings → Environment
   Variables), add:
   - `REPLICATE_TOKEN` = your token from step 1
4. Deploy.

That's the whole setup. No Firebase project, no billing plan, no service
account.

## Notes / known limitations

- **The generated video's link may expire after a while** (it's hosted by
  Replicate, not by you) — download or repost it promptly rather than
  bookmarking it long-term.
- **No auth yet.** Anyone with your deployed URL can trigger generations,
  which cost you Replicate usage. Fine for personal use; add a password
  gate or Vercel's built-in auth before sharing the link widely.
- **Images are capped around 8MB** (see `pages/api/render.js`) — plenty for
  phone photos, but very large files will be rejected. Raise `sizeLimit` if
  needed.
- **Check the model's input schema** at the Replicate link above if
  generation starts failing — providers occasionally rename input fields.
