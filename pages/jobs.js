import { useEffect, useState } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebaseClient";

export default function Jobs() {
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    const q = query(collection(db, "renderJobs"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Jobs</h1>
      {jobs.map((j) => (
        <div key={j.id} style={{ border: "1px solid #ddd", margin: 8, padding: 12 }}>
          <p><strong>Prompt:</strong> {j.prompt}</p>
          <p><strong>Status:</strong> {j.status}</p>
          {j.mp4Url && (
            <video src={j.mp4Url} controls style={{ width: 240 }} />
          )}
        </div>
      ))}
    </main>
  );
}
