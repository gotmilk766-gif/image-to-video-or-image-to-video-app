import { useState } from "react";
import Header from "../components/Header";
import HistoryGallery from "../components/HistoryGallery";
import { makeThumbnail, addToHistory } from "../lib/thumbnail";
import {
  PLATFORM_PRESETS,
  ASPECT_OPTIONS,
  DURATION_PRESETS,
  RESOLUTION_OPTIONS,
  WATERMARK_POSITIONS,
} from "../lib/presets";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function uid() {
  return crypto.randomUUID();
}

const MAX_CONCURRENT = 2;
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 100; // ~5 min per item

export default function Home() {
  const [items, setItems] = useState([]);
  const [preset, setPreset] = useState(PLATFORM_PRESETS[0].id);
  const [customAspect, setCustomAspect] = useState("9:16");
  const [sharedPrompt, setSharedPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [resolution, setResolution] = useState("480p");
  const [numFrames, setNumFrames] = useState(DURATION_PRESETS[0].frames);
  const [seed, setSeed] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [brandingEnabled, setBrandingEnabled] = useState(false);
  const [brandPosition, setBrandPosition] = useState("bottom-right");
  const [brandOpacity, setBrandOpacity] = useState(0.85);
  const [ctaText, setCtaText] = useState("");

  const [historyTick, setHistoryTick] = useState(0);
  const [savedIds] = useState(() => new Set());

  const activePreset = PLATFORM_PRESETS.find((p) => p.id === preset);
  const aspect = activePreset?.aspect || customAspect;
  const presetLabel = activePreset?.label || "Custom";

  const updateItem = (id, patch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const newItems = await Promise.all(
      files.map(async (file) => {
        const thumbnail = await makeThumbnail(file).catch(() => null);
        return {
          id: uid(),
          file,
          thumbnail,
          previewUrl: URL.createObjectURL(file),
          prompt: sharedPrompt,
          status: "pending",
          mp4Url: null,
          error: null,
          brandedLoading: false,
          brandedUrl: null,
        };
      })
    );
    setItems((prev) => [...prev, ...newItems]);
    e.target.value = "";
  };

  const pollStatus = (id, predictionId) => {
    let polls = 0;
    const tick = async () => {
      polls += 1;
      try {
        const resp = await fetch(`/api/render/status?id=${predictionId}`);
        const data = await resp.json();

        if (data.status === "succeeded") {
          updateItem(id, { status: "succeeded", mp4Url: data.mp4Url });
          return;
        }
        if (data.status === "failed" || data.status === "canceled") {
          updateItem(id, { status: "failed", error: data.error || "Generation failed" });
          return;
        }
        if (polls >= MAX_POLLS) {
          updateItem(id, { status: "failed", error: "Timed out waiting for result" });
          return;
        }
        setTimeout(tick, POLL_INTERVAL_MS);
      } catch (err) {
        updateItem(id, { status: "failed", error: err.message });
      }
    };
    setTimeout(tick, POLL_INTERVAL_MS);
  };

  const startItem = async (item) => {
    updateItem(item.id, { status: "starting", error: null });
    try {
      const imageBase64 = await fileToBase64(item.file);
      const resp = await fetch("/api/render/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64,
          prompt: item.prompt,
          negativePrompt,
          aspect,
          numFrames,
          resolution,
          seed,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to start");

      updateItem(item.id, { status: "processing" });
      pollStatus(item.id, data.id);
    } catch (err) {
      updateItem(item.id, { status: "failed", error: err.message });
    }
  };

  const generateAll = async () => {
    const pending = items.filter((it) => it.status === "pending" || it.status === "failed");
    let idx = 0;
    const workers = new Array(Math.min(MAX_CONCURRENT, pending.length))
      .fill(null)
      .map(async () => {
        while (idx < pending.length) {
          const item = pending[idx];
          idx += 1;
          await startItem(item);
        }
      });
    await Promise.all(workers);
  };

  // Save each successful item to history as it completes.
  items.forEach((it) => {
    if (it.status === "succeeded" && it.mp4Url && !savedIds.has(it.id)) {
      savedIds.add(it.id);
      addToHistory({
        id: it.id,
        mp4Url: it.mp4Url,
        prompt: it.prompt,
        presetLabel,
        thumbnail: it.thumbnail,
      });
      setHistoryTick((t) => t + 1);
    }
  });

  const downloadBranded = async (item) => {
    updateItem(item.id, { brandedLoading: true });
    try {
      const resp = await fetch("/api/watermark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: item.mp4Url,
          position: brandPosition,
          opacity: brandOpacity,
          ctaText,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || "Branding failed");
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kowalzki-studio-branded.mp4";
      a.click();
      updateItem(item.id, { brandedLoading: false, brandedUrl: url });
    } catch (err) {
      updateItem(item.id, { brandedLoading: false, error: err.message });
    }
  };

  const removeItem = (id) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const anyPending = items.some((it) => it.status === "pending" || it.status === "failed");
  const anyBusy = items.some((it) => it.status === "starting" || it.status === "processing");

  return (
    <main className="page">
      <Header hasAuth />

      <div className="card">
        <p className="subtitle">
          Upload one or more images, describe the motion, and generate short
          videos for TikTok, Reels, YouTube Shorts, or paid social/marketing
          formats.
        </p>

        <label className="field">
          <span>Images (you can select several)</span>
          <input type="file" accept="image/*" multiple onChange={handleFiles} />
        </label>

        <label className="field">
          <span>Platform preset</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PLATFORM_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        {preset === "custom" && (
          <label className="field">
            <span>Aspect ratio</span>
            <select value={customAspect} onChange={(e) => setCustomAspect(e.target.value)}>
              {ASPECT_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>Default motion prompt (applied to newly added images)</span>
          <textarea
            placeholder="e.g. slow zoom in, hair blowing in the wind"
            value={sharedPrompt}
            onChange={(e) => setSharedPrompt(e.target.value)}
            rows={2}
          />
        </label>

        <button
          type="button"
          className="ghost small"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "Hide" : "Show"} advanced controls
        </button>

        {showAdvanced && (
          <div className="advanced-grid">
            <label className="field">
              <span>Resolution</span>
              <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                {RESOLUTION_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Duration</span>
              <select value={numFrames} onChange={(e) => setNumFrames(Number(e.target.value))}>
                {DURATION_PRESETS.map((d) => (
                  <option key={d.frames} value={d.frames}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Negative prompt (optional)</span>
              <input
                type="text"
                placeholder="e.g. blurry, distorted, low quality"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Seed (optional, for reproducible results)</span>
              <input
                type="number"
                placeholder="random"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
            </label>
          </div>
        )}

        <div className="branding-box">
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={brandingEnabled}
              onChange={(e) => setBrandingEnabled(e.target.checked)}
            />
            <span>Enable Kowalzki Studio branding on downloads</span>
          </label>
          {brandingEnabled && (
            <div className="advanced-grid">
              <label className="field">
                <span>Logo/watermark position</span>
                <select value={brandPosition} onChange={(e) => setBrandPosition(e.target.value)}>
                  {WATERMARK_POSITIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Opacity ({Math.round(brandOpacity * 100)}%)</span>
                <input
                  type="range"
                  min="0.3"
                  max="1"
                  step="0.05"
                  value={brandOpacity}
                  onChange={(e) => setBrandOpacity(Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>CTA text overlay (optional, e.g. "Shop now — link in bio")</span>
                <input
                  type="text"
                  value={ctaText}
                  onChange={(e) => setCtaText(e.target.value)}
                />
              </label>
            </div>
          )}
          <p className="hint">
            Drop your real logo file at <code>public/logo.png</code> to use
            it in the overlay — until then a text badge in your brand colors
            is used as a placeholder.
          </p>
        </div>

        <button
          onClick={generateAll}
          disabled={!anyPending || anyBusy}
          className="primary"
        >
          {anyBusy
            ? "Generating…"
            : `Generate ${items.filter((it) => it.status === "pending").length || ""} video${
                items.length === 1 ? "" : "s"
              }`.trim()}
        </button>
      </div>

      {items.length > 0 && (
        <div className="card queue-card">
          <h2>Queue</h2>
          <div className="queue-grid">
            {items.map((item) => (
              <div className="queue-item" key={item.id}>
                <img src={item.previewUrl} alt="" className="preview" />
                <label className="field">
                  <span>Prompt for this image</span>
                  <textarea
                    rows={2}
                    value={item.prompt}
                    onChange={(e) => updateItem(item.id, { prompt: e.target.value })}
                    disabled={item.status === "starting" || item.status === "processing"}
                  />
                </label>
                <p className={`status status-${item.status}`}>
                  {item.status === "pending" && "Ready"}
                  {item.status === "starting" && "Starting…"}
                  {item.status === "processing" && "Generating… (usually 1–3 min)"}
                  {item.status === "succeeded" && "Done"}
                  {item.status === "failed" && `Failed: ${item.error}`}
                </p>

                {item.status === "succeeded" && item.mp4Url && (
                  <div className="result">
                    <video src={item.mp4Url} controls />
                    <div className="result-actions">
                      <a href={item.mp4Url} download className="download">
                        Download original
                      </a>
                      {brandingEnabled && (
                        <button
                          className="secondary"
                          onClick={() => downloadBranded(item)}
                          disabled={item.brandedLoading}
                        >
                          {item.brandedLoading ? "Branding…" : "Download branded"}
                        </button>
                      )}
                    </div>
                    <p className="hint">
                      Save this soon — the link may expire after a while.
                    </p>
                  </div>
                )}

                <button className="ghost small" onClick={() => removeItem(item.id)}>
                  Remove from queue
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <HistoryGallery refreshKey={historyTick} />
      </div>
    </main>
  );
}
