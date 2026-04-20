import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_BASE } from "../api/client";

export function CompareSnapshotLoader() {
  const { shortId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!shortId) {
      navigate("/compare", { replace: true });
      return;
    }
    fetch(`${API_BASE}/api/compare/snapshots/${shortId}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((d) => {
        const ids = Array.isArray(d.strategy_ids) ? d.strategy_ids : [];
        if (ids.length === 0) {
          navigate("/compare", { replace: true });
          return;
        }
        navigate(`/compare?ids=${ids.join(",")}`, { replace: true });
      })
      .catch(() => {
        navigate("/compare", { replace: true });
      });
  }, [shortId, navigate]);

  return (
    <div style={{ fontFamily: "sans-serif", padding: 40, textAlign: "center" }}>
      共有リンクを読み込んでいます...
    </div>
  );
}
