import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import "@/types/electronBridge";
import { MandatoryUpdateModal } from "@/components/MandatoryUpdateModal";

const queryClient = new QueryClient();

function ElectronVersionGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<{
    checked: boolean;
    blocked: boolean;
    appVersion: string;
    minRequired: string;
  }>({ checked: false, blocked: false, appVersion: "", minRequired: "" });

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.electron : undefined;
    if (!api?.getVersionGate) {
      setGate((g) => ({ ...g, checked: true, blocked: false }));
      return;
    }
    void api.getVersionGate().then(
      (r) => {
        setGate({
          checked: true,
          blocked: r.blocked,
          appVersion: r.appVersion,
          minRequired: r.minRequiredVersion ?? "",
        });
      },
      () => {
        setGate((g) => ({ ...g, checked: true, blocked: false }));
      }
    );
  }, []);

  if (!gate.checked) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background text-sm text-muted-foreground">
        버전 확인 중…
      </div>
    );
  }
  if (gate.blocked) {
    return <MandatoryUpdateModal currentVersion={gate.appVersion} minRequiredVersion={gate.minRequired} />;
  }
  return <>{children}</>;
}

// Electron(file://)에서는 HashRouter 사용 - BrowserRouter는 pathname을 파일 경로로 잘못 인식함
const Router = typeof window !== "undefined" && window.electron ? HashRouter : BrowserRouter;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ElectronVersionGate>
        <Router>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Router>
      </ElectronVersionGate>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
