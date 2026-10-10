import workerCode from "../vendor/pdf.worker.min.js?raw";

let ready: Promise<any> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("failed to load " + src));
    document.head.appendChild(el);
  });
}

export function getPdfjs(): Promise<any> {
  if (!ready) {
    ready = (async () => {
      if (!(window as any).pdfjsLib) {
        await loadScript("vendor/pdf.min.js");
      }
      const lib = (window as any).pdfjsLib;
      const blob = new Blob([workerCode], { type: "application/javascript" });
      lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
      return lib;
    })();
  }
  return ready;
}
