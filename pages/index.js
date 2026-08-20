import { useState } from "react";

const ASPECTS = [
  { label: "Vertical (TikTok / Reels) 9:16", value: "9:16" },
  { label: "Square 1:1", value: "1:1" },
  { label: "Landscape 16:9", value: "16:9" },
];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); // data:image/png;base64,....
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleFile = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  };

  const submit = async () => {
    setError(null);
    setResult(null);

    if (!file) return setError("Choose an image first.");

    setLoading(true);
    try {
      const imageBase64 = await fileToBase64(file);

      const resp = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, prompt, aspect }),
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
    <main className="page">
      <div className="card">
        <h1>Image → Video</h1>
        <p className="subtitle">
          Upload an image, describe the motion, and generate a short vertical
          video for TikTok, Reels, or Fanvue.
        </p>

        <label className="field">
          <span>Image</span>
          <input type="file" accept="image/*" onChange={handleFile} />
        </label>

        {previewUrl && (
          <img src={previewUrl} alt="preview" className="preview" />
        )}

        <label className="field">
          <span>Motion prompt</span>
          <textarea
            placeholder="e.g. slow zoom in, hair blowing in the wind"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
        </label>

        <label className="field">
          <span>Aspect ratio</span>
          <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
            {ASPECTS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        <button onClick={submit} disabled={loading} className="primary">
          {loading ? "Generating… (usually 1–3 min)" : "Generate video"}
        </button>

        {error && <p className="error">{error}</p>}

        {result?.mp4Url && (
          <div className="result">
            <video src={result.mp4Url} controls />
            <a href={result.mp4Url} download className="download">
              Download MP4
            </a>
            <p className="hint">
              Save this soon — the link may expire after a while.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
