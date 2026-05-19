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

/** Electron은 file:// 로 열림. BrowserRouter는 이 때 pathname이 파일 경로로 잡혀 라우팅이 깨지고 새로고침(Ctrl+R) 시 빈 화면이 나올 수 있음 */
function FileOrElectronRouter({ children }: { children: ReactNode }) {
  const useHash =
    typeof window !== "undefined" &&
    (window.location.protocol === "file:" || typeof window.electron !== "undefined");
  if (useHash) {
    return <HashRouter>{children}</HashRouter>;
  }
  return <BrowserRouter>{children}</BrowserRouter>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ElectronVersionGate>
        <FileOrElectronRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </FileOrElectronRouter>
      </ElectronVersionGate>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
