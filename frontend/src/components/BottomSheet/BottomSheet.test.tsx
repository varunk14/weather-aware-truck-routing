import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BottomSheet, MOVE_MS, type SheetSnap } from "./BottomSheet";

const CONTAINER_HEIGHT = 800;
const PEEK_CONTENT_HEIGHT = 150;

beforeEach(() => {
  // jsdom does no layout; give the sheet's container and peek content real sizes.
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(CONTAINER_HEIGHT);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(PEEK_CONTENT_HEIGHT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Harness() {
  const [snap, setSnap] = useState<SheetSnap>("peek");
  return (
    <div>
      <BottomSheet
        label="Trip"
        snap={snap}
        onSnapChange={setSnap}
        peek={<button type="button">Edit</button>}
      >
        <button type="button">Route A</button>
      </BottomSheet>
    </div>
  );
}

function sheet() {
  return screen.getByRole("region", { name: "Trip" });
}

describe("BottomSheet", () => {
  it("starts at the peek height: the handle plus the peek content", () => {
    render(<Harness />);

    expect(sheet()).toHaveStyle({ height: "194px" });
    expect(screen.getByRole("button", { name: "Show more of the trip panel" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("keeps the rest of the content out of reach while peeking", () => {
    render(<Harness />);

    expect(screen.getByRole("button", { name: "Route A" }).closest("[inert]")).not.toBeNull();
  });

  it("cycles peek, half, full and back with the handle", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const handle = screen.getByRole("button", { name: /trip panel/ });

    await user.click(handle);
    expect(sheet()).toHaveStyle({ height: "440px" });
    expect(handle).toHaveAttribute("aria-expanded", "true");

    await user.click(handle);
    expect(sheet()).toHaveStyle({ height: "792px" });
    expect(handle).toHaveAccessibleName("Show less of the trip panel");

    await user.click(handle);
    expect(sheet()).toHaveAttribute("data-snap", "peek");
  });

  it("steps with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole("button", { name: /trip panel/ }).focus();

    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(sheet()).toHaveAttribute("data-snap", "full");

    await user.keyboard("{ArrowDown}");
    expect(sheet()).toHaveAttribute("data-snap", "half");
  });

  it("follows a drag and settles at the nearest position", () => {
    render(<Harness />);
    const grab = screen.getByRole("button", { name: /trip panel/ }).parentElement;
    if (!grab) throw new Error("The sheet has no drag area.");

    fireEvent.pointerDown(grab, { pointerId: 1, button: 0, clientY: 700 });
    fireEvent.pointerMove(grab, { pointerId: 1, clientY: 420 });
    expect(sheet()).toHaveAttribute("data-dragging");
    expect(sheet()).toHaveStyle({ height: "474px" });

    fireEvent.pointerUp(grab, { pointerId: 1, clientY: 420 });
    expect(sheet()).not.toHaveAttribute("data-dragging");
    expect(sheet()).toHaveAttribute("data-snap", "half");
  });

  it("treats a small movement as a tap, so buttons in the sheet still work", async () => {
    const onClick = vi.fn();
    render(
      <BottomSheet
        label="Trip"
        snap="peek"
        onSnapChange={vi.fn()}
        peek={
          <button type="button" onClick={onClick}>
            Edit
          </button>
        }
      />,
    );
    const edit = screen.getByRole("button", { name: "Edit" });

    fireEvent.pointerDown(edit, { pointerId: 2, button: 0, clientY: 700 });
    fireEvent.pointerMove(edit, { pointerId: 2, clientY: 697 });
    fireEvent.pointerUp(edit, { pointerId: 2, clientY: 697 });
    await userEvent.setup().click(edit);

    expect(onClick).toHaveBeenCalled();
    expect(sheet()).not.toHaveAttribute("data-dragging");
  });

  it("moves the keyboard focus to the handle when the content it was on is lowered away", async () => {
    function PickRoute() {
      const [snap, setSnap] = useState<SheetSnap>("half");
      return (
        <div>
          <BottomSheet label="Trip" snap={snap} onSnapChange={setSnap} peek="Trip summary">
            <button
              type="button"
              onClick={() => {
                setSnap("peek");
              }}
            >
              Route B
            </button>
          </BottomSheet>
        </div>
      );
    }
    const user = userEvent.setup();
    render(<PickRoute />);

    screen.getByRole("button", { name: "Route B" }).focus();
    await user.keyboard("{Enter}");

    expect(sheet()).toHaveAttribute("data-snap", "peek");
    expect(screen.getByRole("button", { name: "Show more of the trip panel" })).toHaveFocus();
  });

  it("lets peek content that is too tall scroll instead of cutting it off", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(600);
    render(<Harness />);

    // 45% of the 800 px area, with the content capped below the 44 px handle.
    expect(sheet()).toHaveStyle({ height: "360px" });
    expect(sheet()).toHaveAttribute("data-peek-overflows");
    expect(screen.getByRole("button", { name: "Edit" }).parentElement).toHaveStyle({
      maxHeight: "316px",
    });
  });

  it("with a bar, lowers to only the bar and cycles bar, peek, half, full", async () => {
    function WithBar() {
      const [snap, setSnap] = useState<SheetSnap>("bar");
      return (
        <div>
          <BottomSheet
            label="Trip"
            snap={snap}
            onSnapChange={setSnap}
            bar={<p>Denver to Chicago</p>}
            peek={<button type="button">Why Route A</button>}
          >
            <button type="button">Route A</button>
          </BottomSheet>
        </div>
      );
    }
    const user = userEvent.setup();
    render(<WithBar />);
    const handle = screen.getByRole("button", { name: /trip panel/ });

    // The handle and the 150 px bar; the peek content and the rest are out of reach.
    expect(sheet()).toHaveStyle({ height: "194px" });
    expect(screen.getByText("Denver to Chicago").closest("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "Why Route A" }).closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Route A" }).closest("[inert]")).not.toBeNull();

    await user.click(handle);
    expect(sheet()).toHaveAttribute("data-snap", "peek");
    expect(sheet()).toHaveStyle({ height: "344px" });
    expect(screen.getByRole("button", { name: "Why Route A" }).closest("[inert]")).toBeNull();

    await user.click(handle);
    await user.click(handle);
    expect(sheet()).toHaveAttribute("data-snap", "full");
    await user.click(handle);
    expect(sheet()).toHaveAttribute("data-snap", "bar");

    handle.focus();
    await user.keyboard("{ArrowUp}{ArrowDown}{ArrowDown}");
    expect(sheet()).toHaveAttribute("data-snap", "bar");
  });

  it("shows its lowest position, the peek, when asked for a bar it does not have", () => {
    render(<BottomSheet label="Trip" snap="bar" onSnapChange={vi.fn()} peek="Plan a trip" />);

    expect(sheet()).toHaveAttribute("data-snap", "peek");
    expect(sheet()).toHaveStyle({ height: "194px" });
  });

  it("glides only to a new position, not when the screen changes size under it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    // Measured, and ready to animate, but not moving.
    await new Promise((done) => requestAnimationFrame(done));
    expect(sheet()).not.toHaveAttribute("data-animated");

    await user.click(screen.getByRole("button", { name: /trip panel/ }));
    expect(sheet()).toHaveAttribute("data-animated");
    await waitFor(
      () => {
        expect(sheet()).not.toHaveAttribute("data-animated");
      },
      { timeout: MOVE_MS * 3 },
    );

    // A phone's keyboard opens: the sheet takes its new height at once.
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
    rerender(<Harness />);
    expect(sheet()).toHaveStyle({ height: "275px" });
    expect(sheet()).not.toHaveAttribute("data-animated");
  });

  it("reports its settled height", () => {
    const onHeightChange = vi.fn();
    const sheetAt = (snap: SheetSnap) => (
      <BottomSheet
        label="Trip"
        snap={snap}
        onSnapChange={vi.fn()}
        onHeightChange={onHeightChange}
        peek="Trip summary"
      />
    );
    const { rerender } = render(sheetAt("peek"));
    expect(onHeightChange).toHaveBeenLastCalledWith(194);

    act(() => {
      rerender(sheetAt("half"));
    });
    expect(onHeightChange).toHaveBeenLastCalledWith(440);
  });
});
