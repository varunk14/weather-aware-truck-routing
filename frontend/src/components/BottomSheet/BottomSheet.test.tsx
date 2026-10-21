import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BottomSheet, type SheetSnap } from "./BottomSheet";

const CONTAINER_HEIGHT = 800;
const PEEK_CONTENT_HEIGHT = 150;

beforeEach(() => {
  // jsdom does no layout; give the sheet's container and peek content real sizes.
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(CONTAINER_HEIGHT);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(PEEK_CONTENT_HEIGHT);
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
