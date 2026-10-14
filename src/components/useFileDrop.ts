import { useEffect, useState } from "react";

/** Files dropped anywhere on the page go to `onFiles`. Returns whether something is being dragged over it. */
export function useFileDrop(onFiles: (files: File[]) => void): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; depth++; setOver(true); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setOver(false); };
    const overIt = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) onFiles(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overIt);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overIt);
      window.removeEventListener("drop", drop);
    };
  }, [onFiles]);
  return over;
}
