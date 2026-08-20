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
const MODEL_VERSION = "REPLICATE_MODEL_VERSION"; // e.g. "owner/model@version"

exports.createRenderJob = functions.https.onRequest(async (req, res) => {
  try {
    const { imageUrls, prompt, duration = 8, fps = 24 } = req.body || {};
    if (!imageUrls || !prompt) return res.status(400).json({ error: "missing imageUrls or prompt" });

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
    const startJson = await startResp.json();
    const predictionId = startJson.id;
    await jobRef.update({ status: "running", replicateId: predictionId, startedAt: admin.firestore.FieldValue.serverTimestamp() });

    // Polling loop (simple)
    let prediction = startJson;
    while (prediction.status !== "succeeded" && prediction.status !== "failed") {
      await new Promise((r) => setTimeout(r, 3000));
      const statusResp = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { Authorization: `Token ${REPLICATE_TOKEN}` }
      });
      prediction = await statusResp.json();
    }

    if (prediction.status === "failed") {
      await jobRef.update({ status: "failed", error: prediction });
      return res.status(500).json({ jobId: jobRef.id, status: "failed" });
    }

    // model output handling varies; many models return prediction.output as array of urls
    let outputUrl = null;
    if (Array.isArray(prediction.output)) {
      outputUrl = prediction.output[0];
    } else {
      outputUrl = prediction.output;
    }
    if (!outputUrl) {
      await jobRef.update({ status: "failed", error: "no output url" });
      return res.status(500).json({ jobId: jobRef.id, status: "failed" });
    }

    // Download file and upload to Firebase Storage
    const outResp = await fetch(outputUrl);
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
