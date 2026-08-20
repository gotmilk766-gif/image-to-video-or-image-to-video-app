import { useState } from "react";
import { useRouter } from "next/router";

export default function Login() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const resp = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Login failed");
      const next = router.query.next || "/";
      router.push(Array.isArray(next) ? next[0] : next);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page login-page">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand-mark">
          <span className="brand-crown">♛</span>
          <span className="brand-word">
            KOWALZKI <span className="accent-gold">STUDIO</span>
          </span>
        </div>
        <h1>Video Generator</h1>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </label>
        <button type="submit" disabled={loading} className="primary">
          {loading ? "Checking…" : "Enter"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
