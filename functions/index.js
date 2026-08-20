const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

const REPLICATE_TOKEN = functions.config().replicate?.token;
if (!REPLICATE_TOKEN) {
  console.warn("No replicate token set in functions config. Set with: firebase functions:config:set replicate.token=\"TOKEN\"");
}

// Replace with the model version id you choose on Replicate marketplace
let MODEL_VERSION = "REPLICATE_MODEL_VERSION"; // e.g. "owner/model@version"

// Helper to add CORS headers for browser calls
function setCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

exports.createRenderJob = functions.https.onRequest(async (req, res) => {
  // Basic CORS handling
  setCors(res);
  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  try {
    const { imageUrls, prompt, duration = 8, fps = 24, modelVersion } = req.body || {};
    if (!imageUrls || !prompt) return res.status(400).json({ error: "missing imageUrls or prompt" });

    // Optionally allow caller to override model version per-request
    if (modelVersion && typeof modelVersion === 'string') {
      MODEL_VERSION = modelVersion;
    }

    const jobRef = await db.collection("renderJobs").add({
      imageUrls,
      prompt,
      duration,
      fps,
      status: "queued",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Start Replicate prediction
    const startResp = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${REPLICATE_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: MODEL_VERSION,
        input: {
          images: imageUrls,
          prompt,
          duration,
          fps
        }
      })
    });

    if (!startResp.ok) {
      const errText = await startResp.text();
      console.error('Replicate start error:', startResp.status, errText);
      await jobRef.update({ status: 'failed', error: `replicate start failed: ${startResp.status}` });
      return res.status(500).json({ error: 'replicate start failed', details: errText });
    }

    const startJson = await startResp.json();
    const predictionId = startJson.id;
    await jobRef.update({ status: "running", replicateId: predictionId, startedAt: admin.firestore.FieldValue.serverTimestamp() });

    // Polling loop (simple). Consider using webhooks if model/provider supports.
    let prediction = startJson;
    const maxChecks = 120; // avoid infinite loops; ~6 minutes with 3s interval
    let checks = 0;
    while (prediction.status !== "succeeded" && prediction.status !== "failed" && checks < maxChecks) {
      await new Promise((r) => setTimeout(r, 3000));
      checks += 1;
      const statusResp = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { Authorization: `Token ${REPLICATE_TOKEN}` }
      });
      if (!statusResp.ok) {
        const errText = await statusResp.text();
        console.error('Replicate status error:', statusResp.status, errText);
        break;
      }
      prediction = await statusResp.json();
    }

    if (prediction.status === "failed") {
      await jobRef.update({ status: "failed", error: prediction });
      return res.status(500).json({ jobId: jobRef.id, status: "failed", error: prediction });
    }

    if (checks >= maxChecks && prediction.status !== 'succeeded') {
      await jobRef.update({ status: 'failed', error: 'prediction timeout' });
      return res.status(500).json({ jobId: jobRef.id, status: 'failed', error: 'prediction timeout' });
    }

    // model output handling varies; many models return prediction.output as array of urls or a single url or structured object
    let outputUrl = null;
    if (!prediction.output) {
      // Some models provide output in prediction.result or other keys; log the whole object for debugging
      console.warn('No prediction.output; full prediction obj:', JSON.stringify(prediction).slice(0, 2000));
    }
    if (Array.isArray(prediction.output)) {
      outputUrl = prediction.output[0];
    } else if (typeof prediction.output === 'string') {
      outputUrl = prediction.output;
    } else if (prediction.output && prediction.output[0] && typeof prediction.output[0] === 'string') {
      outputUrl = prediction.output[0];
    } else if (prediction.output && prediction.output.video) {
      outputUrl = prediction.output.video;
    }

    if (!outputUrl) {
      await jobRef.update({ status: "failed", error: "no output url", prediction });
      return res.status(500).json({ jobId: jobRef.id, status: "failed", error: "no output url", prediction });
    }

    // Download file and upload to Firebase Storage
    const outResp = await fetch(outputUrl);
    if (!outResp.ok) {
      const errText = await outResp.text();
      console.error('Failed to download output:', outResp.status, errText);
      await jobRef.update({ status: 'failed', error: `download failed: ${outResp.status}` });
      return res.status(500).json({ error: 'download failed', details: errText });
    }
    const buffer = await outResp.arrayBuffer();
    const fileName = `videos/${jobRef.id}.mp4`;
    const file = storage.bucket().file(fileName);
    await file.save(Buffer.from(buffer), { contentType: "video/mp4" });

    // Generate signed URL (long expiration)
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: '03-09-2491'
    });

    await jobRef.update({
      status: "succeeded",
      mp4Url: signedUrl,
      finishedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.json({ jobId: jobRef.id, mp4Url: signedUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});
