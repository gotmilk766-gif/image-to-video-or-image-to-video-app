// This runs on Vercel's servers, not in the browser -- so REPLICATE_TOKEN
// stays secret. Set it in Vercel: Project Settings -> Environment Variables.

// Cheapest/fastest widely-used image-to-video model as of mid-2026.
// If generation starts failing, check https://replicate.com/wan-video/wan-2.2-i2v-fast
// for the current input field names -- providers occasionally rename them.
const MODEL = "wan-video/wan-2.2-i2v-fast";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const token = process.env.REPLICATE_TOKEN;
  if (!token) {
    return res.status(500).json({
      error: "REPLICATE_TOKEN is not set on the server (check Vercel env vars).",
    });
  }

  try {
    const { imageBase64, prompt = "", aspect = "9:16" } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 is required" });
    }

    // Start the prediction. "Prefer: wait" holds the connection open and
    // returns as soon as it's done (up to ~60s), skipping a poll round-trip
    // for short jobs.
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
            image: imageBase64,
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

    // Poll if it wasn't done within the wait window.
    const maxChecks = 40; // ~2 minutes at 3s intervals
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

    return res.status(200).json({ mp4Url: outputUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

// Base64 image data URIs can be a few MB; raise the body size limit
// (default is 1MB) so uploads don't get rejected.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "8mb",
    },
  },
};
