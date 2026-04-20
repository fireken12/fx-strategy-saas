import { useToast } from "../contexts/ToastContext";

export function useCompareShare(ids: string[]) {
  const { showToast } = useToast();

  const share = async () => {
    const res = await fetch("/api/compare/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy_ids: ids }),
    });
    if (!res.ok) {
      showToast("共有URLの生成に失敗しました", "error");
      return null;
    }
    const data = await res.json();
    const url = location.origin + data.url_path;
    try {
      await navigator.clipboard.writeText(url);
      showToast("共有URLをコピーしました", "success");
    } catch {
      showToast("URL生成は成功しました。手動でコピーしてください: " + url, "warning");
    }
    return data.url_path;
  };

  return { share };
}
