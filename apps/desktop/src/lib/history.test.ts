import { describe, expect, it } from "vitest";
import { BoundedHistory, createHistory } from "./history";

describe("BoundedHistory", () => {
  it("supports undo, redo, and clears redo after a new branch", () => {
    const history = createHistory("initial");

    history.push("first");
    history.push("second");
    expect(history.present).toBe("second");
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);

    expect(history.undo()).toBe("first");
    expect(history.redo()).toBe("second");
    expect(history.undo()).toBe("first");
    history.push("branch");

    expect(history.present).toBe("branch");
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBeUndefined();
  });

  it("keeps exactly the latest 200 undo operations by default", () => {
    const history = createHistory(0);
    for (let value = 1; value <= 250; value += 1) history.push(value);

    expect(history.depth).toBe(200);
    expect(history.present).toBe(250);

    for (let count = 0; count < 200; count += 1) history.undo();
    expect(history.present).toBe(50);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it("supports a custom limit and reset", () => {
    const history = new BoundedHistory("start", 2);
    history.push("one");
    history.push("two");
    history.push("three");

    expect(history.depth).toBe(2);
    expect(history.undo()).toBe("two");
    expect(history.undo()).toBe("one");
    expect(history.undo()).toBeUndefined();

    history.reset("fresh");
    expect(history.present).toBe("fresh");
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it("rejects an invalid limit", () => {
    expect(() => new BoundedHistory(0, 0)).toThrow("positive integer");
    expect(() => new BoundedHistory(0, 1.5)).toThrow("positive integer");
  });
});
