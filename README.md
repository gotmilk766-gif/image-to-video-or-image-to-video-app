# image-to-video-app

Upload an image → get a short vertical video back, for TikTok / Reels / Fanvue.

This is a deliberately small MVP:
- **Frontend:** Next.js, one page. Upload an image, type a motion prompt, get an MP4 back.
- **Backend:** one Firebase Cloud Function. It uploads nothing itself — the browser
  uploads the image straight to Firebase Storage, then calls the function, which
  calls the video model, downloads the result, and re-hosts it in your own Storage
  bucket so you have a permanent link.
- **Model:** [wan-video/wan-2.2-i2v-fast](https://replicate.com/wan-video/wan-2.2-i2v-fast)
  on Replicate — currently the cheapest/fastest widely-used image-to-video model.

No GitHub Actions, no service-account JSON, no CI. You deploy the function once
from your own machine with your own logged-in `firebase` CLI session. Add
automation later, once this actually works end to end.

## 1. Prerequisites

- Node.js 18+ installed
- A Firebase project with **Firestore, Storage, and Functions** enabled, and
  **Blaze (pay-as-you-go) billing** turned on — required because the function
  calls an external API. (Blaze has a generous free tier; you won't be charged
  for light testing.)
- A Replicate account and API token: https://replicate.com/account/api-tokens

## 2. Install

```bash
npm install
cd functions && npm install && cd ..
npm install -g firebase-tools
```

## 3. Connect to your Firebase project

```bash
firebase login
firebase use --add
# pick your project from the list
```

## 4. Set your Replicate token as a Firebase secret

This keeps the token out of your code and out of Git entirely.

```bash
firebase functions:secrets:set REPLICATE_TOKEN
# paste your token when prompted
```

## 5. Deploy the function

```bash
firebase deploy --only functions
```

When it finishes, copy the URL it prints for `createRenderJob`
(also visible any time in Firebase Console → Functions).

## 6. Configure the frontend

```bash
cp .env.local.example .env.local
```

Fill in:
- The six `NEXT_PUBLIC_FIREBASE_*` values — Firebase Console → Project settings →
  General → Your apps → SDK setup and configuration.
- `NEXT_PUBLIC_RENDER_FUNCTION_URL` — the URL from step 5.

## 7. Run it

```bash
npm run dev
```

Open http://localhost:3000, upload an image, add a prompt like
"slow zoom in, hair blowing in the wind", pick an aspect ratio, and generate.
First run will take 1–3 minutes; later ones should be similar (the model isn't
cached between runs on the fast tier).

## 8. Deploy the frontend

Push this repo to GitHub, then import it in Vercel. Add the same env vars from
`.env.local` in Vercel's Project Settings → Environment Variables, and deploy.

## Notes / known limitations (read before you scale this up)

- **Storage rules are wide open by default.** Before letting real users hit
  this, add Firestore/Storage security rules restricting uploads to
  authenticated users.
- **No auth yet.** Anyone with the URL can trigger generations (which cost you
  money per call). Add Firebase Auth before sharing the link publicly.
- **Signed URLs expire after 7 days** in the code above — download or repost
  videos before then, or extend the expiry in `functions/index.js`.
- **The function call is synchronous** (the browser waits for the whole
  generation). Fine for a personal MVP; if you want multiple users generating
  concurrently, move to an async job-queue pattern later.
- **Check the model's input schema** at the Replicate link above if generation
  starts failing — providers occasionally rename input fields.
