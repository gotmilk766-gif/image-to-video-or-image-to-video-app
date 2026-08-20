import { useState } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../lib/firebaseClient";

const ASPECTS = [
  { label: "Vertical (TikTok / Reels) 9:16", value: "9:16" },
  { label: "Square 1:1", value: "1:1" },
  { label: "Landscape 16:9", value: "16:9" },
];

export default function Home() {
  const [file, setFile] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const RENDER_FN = process.env.NEXT_PUBLIC_RENDER_FUNCTION_URL;

  const handleFile = (e) => setFile(e.target.files?.[0] || null);

  const submit = async () => {
    setError(null);
    setResult(null);

    if (!file) return setError("Choose an image first.");
    if (!RENDER_FN) {
      return setError(
        "NEXT_PUBLIC_RENDER_FUNCTION_URL is not set. Add it to .env.local after deploying the function."
      );
    }

    setLoading(true);
    try {
      // 1. Upload the image to Firebase Storage
      const path = `uploads/${Date.now()}-${file.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const imageUrl = await getDownloadURL(storageRef);

      // 2. Call the Cloud Function to start generation
      const resp = await fetch(RENDER_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, prompt, aspect }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || `Request failed (${resp.status})`);
      }

      setResult(data); // { mp4Url }
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 560, margin: "40px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Image → Video</h1>
      <p style={{ color: "#666" }}>
        Upload an image, describe the motion you want, and generate a short vertical
        video for TikTok / Reels / Fanvue.
      </p>

      <div style={{ marginTop: 20 }}>
        <input type="file" accept="image/*" onChange={handleFile} />
      </div>

      <div style={{ marginTop: 12 }}>
        <textarea
          placeholder="Describe the motion, e.g. 'slow zoom in, hair blowing in the wind'"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          style={{ width: "100%", padding: 8 }}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <select value={aspect} onChange={(e) => setAspect(e.target.value)} style={{ padding: 8 }}>
          {ASPECTS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={submit} disabled={loading} style={{ padding: "10px 20px" }}>
          {loading ? "Generating… (can take 1–3 min)" : "Generate video"}
        </button>
      </div>

      {error && (
        <p style={{ color: "crimson", marginTop: 16 }}>
          {error}
        </p>
      )}

      {result?.mp4Url && (
        <div style={{ marginTop: 24 }}>
          <video src={result.mp4Url} controls style={{ width: "100%", maxWidth: 320 }} />
          <p>
            <a href={result.mp4Url} download>
              Download MP4
            </a>
          </p>
        </div>
      )}
    </main>
  );
}
