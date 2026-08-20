const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const storage = admin.storage();

const REPLICATE_TOKEN = defineSecret("REPLICATE_TOKEN");

// Fast, cheap, well-supported image-to-video model on Replicate.
// Check https://replicate.com/wan-video/wan-2.2-i2v-fast for the current
// input schema if this ever stops working -- providers change input fields
// occasionally, more often than the model name itself.
const MODEL = "wan-video/wan-2.2-i2v-fast";

function setCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

exports.createRenderJob = onRequest(
  { secrets: [REPLICATE_TOKEN], timeoutSeconds: 300, memory: "1GiB" },
  async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    try {
      const { imageUrl, prompt = "", aspect = "9:16" } = req.body || {};
      if (!imageUrl) {
        return res.status(400).json({ error: "imageUrl is required" });
      }

      const token = REPLICATE_TOKEN.value();

      // Start the prediction. "Prefer: wait" makes Replicate hold the
      // connection open and return once it's done (up to ~60s), which
      // avoids a separate polling round-trip for short jobs.
      const startResp = await fetch(
        `https://api.replicate.com/v1/models/${MODEL}/predictions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Prefer: "wait=60",
          },
          body: JSON.stringify({
            input: {
              image: imageUrl,
              prompt,
              aspect_ratio: aspect,
            },
          }),
        }
      );

      if (!startResp.ok) {
        const errText = await startResp.text();
        console.error("Replicate start error:", startResp.status, errText);
        return res
          .status(502)
          .json({ error: "Failed to start generation", details: errText });
      }

      let prediction = await startResp.json();

      // If it wasn't done within the wait window, poll for completion.
      const maxChecks = 60; // ~3 minutes at 3s intervals
      let checks = 0;
      while (
        prediction.status !== "succeeded" &&
        prediction.status !== "failed" &&
        prediction.status !== "canceled" &&
        checks < maxChecks
      ) {
        await new Promise((r) => setTimeout(r, 3000));
        checks += 1;
        const statusResp = await fetch(
          `https://api.replicate.com/v1/predictions/${prediction.id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!statusResp.ok) break;
        prediction = await statusResp.json();
      }

      if (prediction.status !== "succeeded") {
        console.error("Prediction did not succeed:", prediction);
        return res.status(500).json({
          error: `Generation ${prediction.status || "timed out"}`,
          details: prediction.error || null,
        });
      }

      const outputUrl = Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;

      if (!outputUrl) {
        return res.status(500).json({ error: "No output from model" });
      }

      // Download the generated video and re-host it in Firebase Storage
      // so you own a permanent copy (Replicate output URLs expire).
      const videoResp = await fetch(outputUrl);
      if (!videoResp.ok) {
        return res.status(500).json({ error: "Failed to download generated video" });
      }
      const buffer = Buffer.from(await videoResp.arrayBuffer());

      const fileName = `videos/${Date.now()}-${prediction.id}.mp4`;
      const file = storage.bucket().file(fileName);
      await file.save(buffer, { contentType: "video/mp4" });

      const [signedUrl] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
      });

      return res.status(200).json({ mp4Url: signedUrl });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
  }
);
