import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  onFiles(files: File[]): void;
  accept?: string;
  multiple?: boolean;
  directory?: boolean;
  className?: string;
}

/**
 * A button that opens the system file picker.
 * The file input lives on <body>, not next to the button: the button may sit in a menu that
 * closes (and unmounts) on click, and an input removed while the picker is open never reports
 * the chosen file.
 */
export function FileButton({ children, onFiles, accept, multiple, directory, className = "btn" }: Props) {
  const pick = () => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.multiple = !!(multiple || directory);
    if (directory) { input.setAttribute("webkitdirectory", ""); input.setAttribute("directory", ""); }
    input.addEventListener("change", () => {
      const files = [...(input.files ?? [])];
      input.remove();
      if (files.length) onFiles(files);
    });
    input.addEventListener("cancel", () => input.remove());
    // iOS Safari only reports the choice for an input that is in the document.
    document.body.appendChild(input);
    input.click();
  };
  return <button type="button" className={className} onClick={pick}>{children}</button>;
}
