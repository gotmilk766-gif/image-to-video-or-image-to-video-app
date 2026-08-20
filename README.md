# image-to-video-or-image-to-video-app

Image → Vertical video for socials (MVP)

This repo is a minimal starter:
- Next.js frontend (Vercel)
- Firebase Auth, Firestore, Storage
- Firebase Cloud Function worker that calls Replicate

Quick local setup
1. Clone repo and install:
   npm install

2. Set up Firebase:
   - Create a Firebase project, enable Firestore & Storage & Functions, enable billing (Blaze) if calling external APIs.
   - Install Firebase CLI: npm i -g firebase-tools
   - firebase login
   - firebase init (choose Functions and Firestore)

3. Set Replicate token (locally and for deploy):
   firebase functions:config:set replicate.token="REPLICATE_API_TOKEN"

4. Local functions auth:
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"   # for local emulation

5. Run locally:
   npm run dev
   # in another terminal, run functions emulation (optional)
   firebase emulators:start --only functions,firestore,storage

6. Deploy:
   firebase deploy --only functions
   # Add environment variables to Vercel (NEXT_PUBLIC_FIREBASE_*) and set NEXT_PUBLIC_RENDER_FUNCTION_URL to the deployed function URL.

Files of interest:
- pages/_app.js, pages/index.js
- lib/firebaseClient.js
- functions/index.js

Notes:
- Replace REPLICATE_MODEL_VERSION in functions/index.js with the model version you pick on Replicate.
- Do not commit secrets.
