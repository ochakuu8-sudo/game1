import { TABLE_W, TABLE_H } from "../physics/layout";

export class InputManager {
  private touchLeftPointers = new Set<number>();
  private touchRightPointers = new Set<number>();
  private keyLeft = false;
  private keyRight = false;
  private tapCallbacks: Array<() => void> = [];
  private tapPosCallbacks: Array<(x: number, y: number) => void> = [];

  constructor(private target: HTMLElement) {
    target.style.touchAction = "none";
    target.addEventListener("pointerdown", this.onPointerDown);
    target.addEventListener("pointerup", this.onPointerUp);
    target.addEventListener("pointercancel", this.onPointerUp);
    target.addEventListener("pointerleave", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", () => {
      this.touchLeftPointers.clear();
      this.touchRightPointers.clear();
      this.keyLeft = false;
      this.keyRight = false;
    });
  }

  get left(): boolean {
    return this.touchLeftPointers.size > 0 || this.keyLeft;
  }

  get right(): boolean {
    return this.touchRightPointers.size > 0 || this.keyRight;
  }

  /** Fires on any pointer press or launch-related key press (space/up). */
  onTap(cb: () => void) {
    this.tapCallbacks.push(cb);
  }

  /** Fires on any pointer press with the tap position in table-space coordinates. */
  onTapPos(cb: (x: number, y: number) => void) {
    this.tapPosCallbacks.push(cb);
  }

  private onPointerDown = (e: PointerEvent) => {
    const rect = this.target.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    if (relX < 0.5) this.touchLeftPointers.add(e.pointerId);
    else this.touchRightPointers.add(e.pointerId);
    // Pointer taps carry a position (for card selection); keyboard taps
    // below go through tapCallbacks only, since they have no position.
    for (const cb of this.tapPosCallbacks) cb(relX * TABLE_W, relY * TABLE_H);
  };

  private onPointerUp = (e: PointerEvent) => {
    this.touchLeftPointers.delete(e.pointerId);
    this.touchRightPointers.delete(e.pointerId);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "ArrowLeft" || e.code === "KeyZ") this.keyLeft = true;
    else if (e.code === "ArrowRight" || e.code === "KeyM" || e.code === "Slash") this.keyRight = true;
    else if (e.code === "Space" || e.code === "ArrowUp") {
      for (const cb of this.tapCallbacks) cb();
    } else return;
    e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "ArrowLeft" || e.code === "KeyZ") this.keyLeft = false;
    else if (e.code === "ArrowRight" || e.code === "KeyM" || e.code === "Slash") this.keyRight = false;
    else return;
    e.preventDefault();
  };
}
