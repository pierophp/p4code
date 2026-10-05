// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Item, ItemSummary } from "@p4code/contracts/items";
import { ItemsView } from "./ItemsView.tsx";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const summary: ItemSummary = {
  id: "1",
  projectId: "project-1" as ItemSummary["projectId"],
  url: "https://github.com/owner/repo/issues/9",
  title: "Track the Item's Threads",
  state: "OPEN",
  author: "owner",
};
const detail: Item = {
  ...summary,
  body: "Issue body",
  comments: [],
  threads: [
    { threadId: "thread-existing", available: true },
    { threadId: "thread-deleted", available: false },
  ],
  lastRefreshedAt: null,
  refreshError: null,
};

it("shows associated Threads and opens an existing or newly started Thread", async () => {
  const openThread = vi.fn();
  const startThread = vi.fn(async () => "thread-new");
  await act(async () => {
    root.render(
      <ItemsView
        list={async () => [summary]}
        create={async () => undefined}
        get={async () => detail}
        refresh={async () => detail}
        startThread={startThread}
        linkThread={async () => undefined}
        unlinkThread={async () => undefined}
        openThread={openThread}
      />,
    );
  });
  const itemButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === summary.title,
  );
  expect(itemButton).toBeDefined();
  await act(async () => itemButton?.click());

  const existing = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("thread-existing"),
  );
  expect(existing).toBeDefined();
  await act(async () => existing?.click());
  expect(openThread).toHaveBeenLastCalledWith("thread-existing");
  expect(container.textContent).toContain("Thread unavailable thread-deleted");
  expect(
    [...container.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("thread-deleted"),
    ),
  ).toBe(false);

  const start = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Start replacement Thread",
  );
  expect(start).toBeDefined();
  await act(async () => start?.click());
  expect(startThread).toHaveBeenCalledWith(summary);
  expect(openThread).toHaveBeenLastCalledWith("thread-new");
});

it("links a Thread from the Item and unlinks it without losing the Item", async () => {
  const openThread = vi.fn();
  const linkThread = vi.fn(async (_item: ItemSummary, _threadId: string) => undefined);
  const unlinkThread = vi.fn(async (_item: ItemSummary, _threadId: string) => undefined);
  let linked = false;
  const get = vi.fn(async () => ({
    ...detail,
    threads: linked ? [{ threadId: "thread-to-link", available: true }] : [],
  }));
  await act(async () => {
    root.render(
      <ItemsView
        list={async () => [summary]}
        create={async () => undefined}
        get={get}
        refresh={async () => detail}
        startThread={async () => "thread-new"}
        linkThread={async (item, threadId) => {
          linkThread(item, threadId);
          linked = true;
        }}
        unlinkThread={async (item, threadId) => {
          unlinkThread(item, threadId);
          linked = false;
        }}
        openThread={openThread}
      />,
    );
  });
  const itemButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === summary.title,
  );
  await act(async () => itemButton?.click());
  const input = container.querySelector<HTMLInputElement>('input[placeholder="Thread ID"]');
  expect(input).toBeDefined();
  await act(async () => {
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "thread-to-link");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  const linkButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Link Thread",
  );
  await act(async () => linkButton?.click());
  expect(linkThread).toHaveBeenCalledWith(summary, "thread-to-link");
  expect(container.textContent).toContain("Open Thread thread-to-link");

  const unlinkButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Unlink",
  );
  await act(async () => unlinkButton?.click());
  expect(unlinkThread).toHaveBeenCalledWith(summary, "thread-to-link");
  expect(container.textContent).toContain("No Threads yet.");
  expect(container.textContent).toContain(summary.title);
});
