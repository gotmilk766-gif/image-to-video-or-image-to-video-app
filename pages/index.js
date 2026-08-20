import { useState } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { storage, db } from "../lib/firebaseClient";

export default function Home() {
  const [files, setFiles] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const RENDER_FN = process.env.NEXT_PUBLIC_RENDER_FUNCTION_URL;

  const handleFiles = (e) => setFiles(Array.from(e.target.files || []));

  const uploadAndCreateJob = async () => {
    if (!files.length || !prompt) return alert("Select images and enter a prompt");
    setLoading(true);
    try {
      const uploadedUrls = [];
      for (const file of files) {
        const path = `uploads/${Date.now()}-${file.name}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        uploadedUrls.push(url);
      }

      // call render function
      const resp = await fetch(RENDER_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrls: uploadedUrls,
          prompt,
          duration: 8,
          fps: 24
        })
      });
      const data = await resp.json();
      // create a local record in Firestore to show job quickly (optional)
      const jobRef = doc(collection(db, "renderJobs"));
      await setDoc(jobRef, {
        prompt,
        imageUrls: uploadedUrls,
        createdAt: serverTimestamp(),
        replicateId: data.replicateId || null,
        status: data.status || "queued"
      });
      alert("Job created: " + (data.jobId || "check jobs list"));
    } catch (err) {
      console.error(err);
      alert("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: 24 }}>
      <h1>Image → Video (vertical)</h1>
      <p>Upload images, enter a prompt, and create a render job.</p>

      <input type="file" multiple accept="image/*" onChange={handleFiles} />
      <div style={{ marginTop: 12 }}>
        <input
          placeholder="Enter prompt..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          style={{ width: "60%" }}
        />
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={uploadAndCreateJob} disabled={loading}>
          {loading ? "Creating..." : "Create Render Job"}
        </button>
      </div>
    </main>
  );
}
