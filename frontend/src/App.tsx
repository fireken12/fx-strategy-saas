import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ToastProvider } from "./contexts/ToastContext";
import { StrategyComparePage } from "./pages/StrategyComparePage";
import { CompareSnapshotLoader } from "./pages/CompareSnapshotLoader";

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/compare" replace />} />
          <Route path="/compare" element={<StrategyComparePage />} />
          <Route path="/compare/s/:shortId" element={<CompareSnapshotLoader />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
