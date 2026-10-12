/** "Точка": the red dot from the logo with a face. The tutorial's character; decorative here. */
export function Mascot({ size = 96, talking = false }: { size?: number; talking?: boolean }) {
  return (
    <span className={"mascot" + (talking ? " talking" : "")} style={{ ["--s" as string]: `${size}px` }} aria-hidden="true">
      <i className="eye l" />
      <i className="eye r" />
      <i className="mouth" />
    </span>
  );
}
